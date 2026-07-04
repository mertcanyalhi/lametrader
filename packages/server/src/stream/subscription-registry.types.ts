/**
 * A subscription kind — the per-stream-type plug describing how the multiplexed
 * `/stream` gateway subscribes, fans payloads back, releases, and maps errors.
 *
 * Each cell that varies between candle / indicator / quote / rule-event
 * subscriptions is a field here; everything else (per-socket active map, `closed`
 * race-check, cleanup-on-close loop) lives once in the
 * {@link import('./subscription-registry.js').SubscriptionRegistry}.
 *
 * Relocated from the old `api/subscription-registry.types.ts` unchanged.
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

/**
 * The minimal WebSocket surface the registry needs to fan frames back — a narrow
 * slice of the standard `WebSocket` interface satisfied by both the `ws` socket
 * and the fake used in unit tests.
 */
export interface SocketLike {
  /** The socket's ready state (compared against {@link OPEN} before a send). */
  readyState: number;
  /** The `OPEN` ready-state constant. */
  OPEN: number;
  /** Send one pre-encoded string frame. */
  send(data: string): void;
}

/**
 * The narrow structured-logging surface the registry writes through — a
 * context-object-first, message-second signature (pino / Fastify style).
 *
 * Replaces the old Fastify `FastifyBaseLogger` dependency: the gateway adapts
 * Nest's `Logger` to this shape, keeping the registry free of any concrete
 * logger. Only the two levels the registry uses are declared.
 */
export interface StreamLog {
  /** Log an informational event with a structured context. */
  info(context: object, message: string): void;
  /** Log a warning with a structured context. */
  warn(context: object, message: string): void;
}
