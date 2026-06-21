/**
 * A subscriber notified of one key's payloads.
 */
export type StreamSubscriber<T> = (payload: T) => void;

/**
 * A tiny in-process pub/sub fanning payloads out to WebSocket subscribers, keyed
 * by an opaque string (a subscription id, symbol id, or job id depending on the
 * stream). Lives in the API adapter so the engine's transport-agnostic callbacks
 * (`onCandle` / `onIndicatorState` / `onSymbolQuote` / `onUpdate`) stay free of
 * transport knowledge (see ADR-0005 / ADR-0008).
 *
 * The caller owns the key: `publish(key, payload)` rather than deriving the key
 * from the payload, so one hub serves both subscription- and symbol-keyed streams.
 */
export class StreamHub<T> {
  /** Subscribers keyed by stream key. */
  private readonly subscribers = new Map<string, Set<StreamSubscriber<T>>>();

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
   */
  publish(key: string, payload: T): void {
    for (const subscriber of this.subscribers.get(key) ?? []) {
      subscriber(payload);
    }
  }
}
