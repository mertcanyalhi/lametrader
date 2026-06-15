import type { IndicatorStateEvent } from '@lametrader/core';

/**
 * A subscriber notified of one subscription's live indicator-state events.
 */
export type IndicatorStreamSubscriber = (event: IndicatorStateEvent) => void;

/**
 * A tiny in-process pub/sub fanning live indicator-state events out to WebSocket subscribers, keyed by `subscriptionId`.
 *
 * Lives in the API adapter so the engine's {@link IndicatorStreamService} stays a plain `onState` callback with no transport knowledge (see ADR-0005).
 *
 * Mirrors {@link CandleStreamHub} but keyed by subscription rather than symbol id — each subscription belongs to one socket, generated server-side at subscribe time.
 */
export class IndicatorStreamHub {
  /** Subscribers keyed by subscription id. */
  private readonly subscribers = new Map<string, Set<IndicatorStreamSubscriber>>();

  /**
   * Subscribe to a subscription's state events.
   *
   * @returns an unsubscribe function.
   */
  subscribe(subscriptionId: string, subscriber: IndicatorStreamSubscriber): () => void {
    const set = this.subscribers.get(subscriptionId) ?? new Set();
    set.add(subscriber);
    this.subscribers.set(subscriptionId, set);
    return () => {
      set.delete(subscriber);
      if (set.size === 0) this.subscribers.delete(subscriptionId);
    };
  }

  /**
   * Publish an indicator-state event to the subscribers of its `subscriptionId`.
   */
  publish(event: IndicatorStateEvent): void {
    for (const subscriber of this.subscribers.get(event.subscriptionId) ?? []) {
      subscriber(event);
    }
  }
}
