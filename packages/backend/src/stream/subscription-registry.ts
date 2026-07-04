import type { SocketLike, StreamLog, SubscriptionKind } from './subscription-registry.types.js';

/**
 * Lifecycle owner for the `/stream` gateway's multiplexed subscriptions.
 *
 * Indexes a fixed set of {@link SubscriptionKind}s by their action strings.
 * On a new socket, call {@link attach} to receive a {@link SocketSubscriptions}
 * facade that owns this connection's active-subscription maps, its `closed`
 * race-check, the acquire→subscribe-hub pipeline, and the cleanup-on-close
 * loop.
 *
 * Adding a stream kind = one factory + one entry in the registry's constructor
 * array. The gateway stays a thin parse-and-dispatch shim.
 *
 * Relocated from the old `api/subscription-registry.ts` unchanged, save for the
 * logger type: the Fastify `FastifyBaseLogger` dependency is replaced by the
 * framework-agnostic {@link StreamLog} port the gateway adapts Nest's `Logger`
 * onto.
 */
export class SubscriptionRegistry {
  /** Subscribe-action → kind. */
  private readonly bySubscribe = new Map<string, SubscriptionKind<unknown, unknown>>();
  /** Unsubscribe-action → kind. */
  private readonly byUnsubscribe = new Map<string, SubscriptionKind<unknown, unknown>>();

  constructor(kinds: ReadonlyArray<SubscriptionKind<unknown, unknown>>) {
    for (const kind of kinds) {
      this.bySubscribe.set(kind.subscribeAction, kind);
      this.byUnsubscribe.set(kind.unsubscribeAction, kind);
    }
  }

  /**
   * Attach the registry to one socket. The returned facade owns the per-socket
   * state — active-subscription maps per kind, the `closed` flag, the
   * acquire→race-check→hub-subscribe→reply pipeline, the unsubscribe handler,
   * and the cleanup-on-close loop.
   */
  attach(socket: SocketLike, log: StreamLog): SocketSubscriptions {
    return new SocketSubscriptions(this.bySubscribe, this.byUnsubscribe, socket, log);
  }
}

/**
 * Per-socket facade returned by {@link SubscriptionRegistry.attach}.
 *
 * Holds an active-subscription map per kind, plus a single `closed` flag and a
 * single cleanup loop — collapsing what would otherwise be four near-identical
 * handler triplets into one shared lifecycle.
 */
export class SocketSubscriptions {
  /** Per-kind active subscriptions: kind → key → hub-unsubscribe handle. */
  private readonly active = new Map<SubscriptionKind<unknown, unknown>, Map<unknown, () => void>>();
  /** Set on socket close so any in-flight `acquire` releases instead of registering. */
  private closed = false;

  constructor(
    private readonly bySubscribe: Map<string, SubscriptionKind<unknown, unknown>>,
    private readonly byUnsubscribe: Map<string, SubscriptionKind<unknown, unknown>>,
    private readonly socket: SocketLike,
    private readonly log: StreamLog,
  ) {}

  /**
   * Route one parsed control message through the appropriate kind. Returns a
   * Promise when the kind's `acquire` is async; otherwise returns `void`.
   * Unknown actions reply with `{error: 'unknown action'}`.
   */
  handle(message: { action?: string } & Record<string, unknown>): Promise<void> | void {
    const action = message.action;
    if (typeof action === 'string') {
      const subscribeKind = this.bySubscribe.get(action);
      if (subscribeKind !== undefined) {
        return this.runSubscribe(subscribeKind, message);
      }
      const unsubscribeKind = this.byUnsubscribe.get(action);
      if (unsubscribeKind !== undefined) {
        this.runUnsubscribe(unsubscribeKind, message);
        return;
      }
    }
    this.log.warn({ message }, 'rejecting invalid stream control message');
    this.send({ error: 'unknown action' });
  }

  /**
   * Tear down every active subscription on this socket — hub-unsubscribe and
   * per-kind `release` (where defined). Idempotent; sets `closed` so any
   * in-flight async `acquire` releases instead of registering.
   */
  cleanup(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [kind, keyMap] of this.active) {
      for (const [key, unsubscribeHub] of keyMap) {
        unsubscribeHub();
        kind.release?.(key);
      }
      keyMap.clear();
    }
  }

  /**
   * Pipeline one subscribe message through a kind: validate → acquire →
   * race-check → hub-subscribe → reply.
   *
   * If the socket closes mid-`acquire`, the resolved key is released (no
   * hub-subscribe, no ack). If `acquire` throws, the error is routed through
   * the kind's mapper.
   */
  private async runSubscribe(
    kind: SubscriptionKind<unknown, unknown>,
    message: unknown,
  ): Promise<void> {
    const validation = kind.validateSubscribe(message);
    if ('error' in validation) {
      this.send({ error: validation.error });
      return;
    }
    let result: { key: unknown; reply?: object };
    try {
      result = await Promise.resolve(kind.acquire(validation.input));
    } catch (error) {
      this.log.warn({ err: error }, `rejecting ${kind.logScope} subscribe`);
      this.send(kind.errorToFrame(error, `${kind.subscribeAction} failed`));
      return;
    }
    if (this.closed) {
      kind.release?.(result.key);
      return;
    }
    const unsubscribeHub = kind.subscribeHub(result.key, (frame) => this.sendRaw(frame));
    let keyMap = this.active.get(kind);
    if (keyMap === undefined) {
      keyMap = new Map();
      this.active.set(kind, keyMap);
    }
    keyMap.set(result.key, unsubscribeHub);
    if (result.reply !== undefined) this.send(result.reply);
    this.log.info({ key: result.key }, `${kind.logScope} subscribed`);
  }

  /**
   * Pipeline one unsubscribe message through a kind: validate → hub-unsub →
   * release.
   */
  private runUnsubscribe(kind: SubscriptionKind<unknown, unknown>, message: unknown): void {
    const validation = kind.validateUnsubscribe(message);
    if ('error' in validation) {
      this.send({ error: validation.error });
      return;
    }
    const keyMap = this.active.get(kind);
    keyMap?.get(validation.key)?.();
    keyMap?.delete(validation.key);
    kind.release?.(validation.key);
    this.log.info({ key: validation.key }, `${kind.logScope} unsubscribed`);
  }

  /** Send a JSON-encoded frame; no-op if the socket has closed. */
  private send(payload: object): void {
    this.sendRaw(JSON.stringify(payload));
  }

  /** Send a pre-encoded frame; no-op if the socket has closed. */
  private sendRaw(frame: string): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(frame);
  }
}
