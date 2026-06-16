import type { SymbolQuoteEvent } from '@lametrader/core';

/**
 * A subscriber notified of one subscription's live quote events.
 */
export type QuoteStreamSubscriber = (event: SymbolQuoteEvent) => void;

/**
 * A tiny in-process pub/sub fanning live quote events out to WebSocket subscribers, keyed by `subscriptionId`.
 *
 * Lives in the API adapter so the engine's {@link QuoteStreamService} stays a plain `onQuote` callback with no transport knowledge (see ADR-0005).
 *
 * Mirrors {@link IndicatorStreamHub} — each subscription belongs to one socket, generated server-side at subscribe time.
 */
export class QuoteStreamHub {
  /** Subscribers keyed by subscription id. */
  private readonly subscribers = new Map<string, Set<QuoteStreamSubscriber>>();

  /**
   * Subscribe to a subscription's quote events.
   *
   * @returns an unsubscribe function.
   */
  subscribe(subscriptionId: string, subscriber: QuoteStreamSubscriber): () => void {
    const set = this.subscribers.get(subscriptionId) ?? new Set();
    set.add(subscriber);
    this.subscribers.set(subscriptionId, set);
    return () => {
      set.delete(subscriber);
      if (set.size === 0) this.subscribers.delete(subscriptionId);
    };
  }

  /**
   * Publish a quote event to the subscribers of its `subscriptionId`.
   */
  publish(event: SymbolQuoteEvent): void {
    for (const subscriber of this.subscribers.get(event.subscriptionId) ?? []) {
      subscriber(event);
    }
  }
}
