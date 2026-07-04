/**
 * A subscriber notified of one key's payloads.
 */
export type StreamSubscriber<T> = (payload: T) => void;

/**
 * A tiny in-process pub/sub fanning payloads out to WebSocket subscribers, keyed
 * by an opaque string (a job id here; a subscription or symbol id for other
 * streams). It keeps the application's transport-agnostic callbacks
 * (`BackfillJobService.onUpdate`) free of transport knowledge (ADR-0005 /
 * ADR-0008) — the gateway subscribes, the application publishes.
 *
 * The caller owns the key: `publish(key, payload)` rather than deriving the key
 * from the payload, so one hub serves both subscription- and symbol-keyed streams.
 *
 * Relocated from the old `api/stream-hub.ts` unchanged.
 */
export class StreamHub<T> {
  /** Subscribers keyed by stream key. */
  private readonly subscribers = new Map<string, Set<StreamSubscriber<T>>>();

  /**
   * @param onError - notified when a subscriber throws during fan-out (e.g. a send to a socket that closed mid-publish). The throw stays isolated — other subscribers still run — but it's reported here instead of vanishing. Defaults to a no-op for embedding/tests.
   */
  constructor(private readonly onError: (error: unknown, key: string) => void = () => {}) {}

  /**
   * Subscribe to a key's payloads.
   *
   * @returns an unsubscribe function.
   */
  subscribe(key: string, subscriber: StreamSubscriber<T>): () => void {
    const set = this.subscribers.get(key) ?? new Set();
    set.add(subscriber);
    this.subscribers.set(key, set);
    return () => {
      set.delete(subscriber);
      if (set.size === 0) this.subscribers.delete(key);
    };
  }

  /**
   * Publish a payload to the subscribers of `key`.
   *
   * Each subscriber is isolated: one that throws (e.g. a send to a socket that
   * closed mid-fan-out) can't starve the rest. The throw is routed to `onError`
   * rather than propagated, so the failure is surfaced without aborting fan-out.
   */
  publish(key: string, payload: T): void {
    for (const subscriber of this.subscribers.get(key) ?? []) {
      try {
        subscriber(payload);
      } catch (error) {
        this.onError(error, key);
      }
    }
  }
}
