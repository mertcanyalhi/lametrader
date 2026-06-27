/**
 * A subscription kind — the per-stream-type plug describing how a `/stream`
 * route subscribes, fans payloads back, releases, and maps errors.
 *
 * Each cell that varies between candle / indicator / quote subscriptions is a
 * field here; everything else (per-socket active map, `closed` race-check,
 * cleanup-on-close loop) lives once in the {@link SubscriptionRegistry}.
 */
export interface SubscriptionKind<TInput, TKey = string> {
  /** Action string the client sends to subscribe — e.g. `'subscribe-indicator'`. */
  subscribeAction: string;
  /** Action string the client sends to unsubscribe. */
  unsubscribeAction: string;
  /**
   * Validate a subscribe control frame. Returns the parsed input or an
   * `{error}` payload that the registry forwards as `{error}` to the client.
   */
  validateSubscribe(message: unknown): { input: TInput } | { error: string };
  /**
   * Validate an unsubscribe control frame. Returns the key to release or an
   * `{error}` payload.
   */
  validateUnsubscribe(message: unknown): { key: TKey } | { error: string };
  /**
   * Acquire the subscription upstream. May be async; may call out to a
   * service. The returned `key` identifies this subscription for hub-subscribe
   * and later release; the optional `reply` is an ack frame the registry
   * sends to the client once acquisition + hub-subscribe succeed.
   *
   * Throwing here is expected for known per-kind errors — the registry routes
   * the throw through {@link errorToFrame} and never lets it crash the socket.
   */
  acquire(input: TInput): Promise<{ key: TKey; reply?: object }> | { key: TKey; reply?: object };
  /**
   * Subscribe to the hub that fans payloads back over the socket. Returns the
   * hub's unsubscribe handle. The registry stores it and invokes it on
   * unsubscribe / cleanup.
   */
  subscribeHub(key: TKey, send: (frame: string) => void): () => void;
  /**
   * Optional: release the upstream resource (a service-side handle) when the
   * client unsubscribes or the socket closes. Hub-subscription teardown
   * happens via the return of {@link subscribeHub} — `release` is for the
   * service-side handle only.
   */
  release?(key: TKey): void;
  /**
   * Map a thrown error to a client-facing `{error}` frame payload. The second
   * arg is the generic fallback string (e.g. `'subscribe-indicator failed'`).
   */
  errorToFrame(error: unknown, generic: string): { error: string };
  /** Log scope tag — e.g. `'candle stream'`, `'indicator stream'`. */
  logScope: string;
}
