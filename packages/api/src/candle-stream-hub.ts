import type { CandleEvent } from '@lametrader/engine';

/**
 * A subscriber notified of a symbol's live candle events.
 */
export type CandleStreamSubscriber = (event: CandleEvent) => void;

/**
 * A tiny in-process pub/sub fanning live candle events out to WebSocket
 * subscribers, keyed by symbol id. Lives in the API adapter so the application's
 * {@link PollingService} stays a plain `onCandle` callback with no transport
 * knowledge (see ADR-0005). Like `BackfillJobHub`, but multiplexed: one socket
 * subscribes to many ids.
 */
export class CandleStreamHub {
  /**
   * Subscribers keyed by canonical symbol id.
   */
  private readonly subscribers = new Map<string, Set<CandleStreamSubscriber>>();

  /**
   * Subscribe to a symbol's live candle events.
   *
   * @returns an unsubscribe function.
   */
  subscribe(id: string, subscriber: CandleStreamSubscriber): () => void {
    const set = this.subscribers.get(id) ?? new Set();
    set.add(subscriber);
    this.subscribers.set(id, set);
    return () => {
      set.delete(subscriber);
      if (set.size === 0) this.subscribers.delete(id);
    };
  }

  /**
   * Publish a candle event to the subscribers of its symbol id.
   */
  publish(event: CandleEvent): void {
    for (const subscriber of this.subscribers.get(event.id) ?? []) {
      subscriber(event);
    }
  }
}
