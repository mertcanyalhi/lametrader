import type { SymbolQuoteEvent } from '@lametrader/core';
import { Period } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { QuoteStreamHub } from './quote-stream-hub.js';

const event = (subscriptionId: string, time: number): SymbolQuoteEvent => ({
  subscriptionId,
  id: 'crypto:BTCUSDT',
  period: Period.OneHour,
  quote: { price: 110, change: 10, changePct: 0.1, time },
  final: true,
});

describe('QuoteStreamHub', () => {
  it('fans an event to every subscriber of its subscriptionId', () => {
    const hub = new QuoteStreamHub();
    const received: SymbolQuoteEvent[] = [];
    hub.subscribe('s1', (e) => received.push(e));

    hub.publish(event('s1', 1));

    expect(received).toEqual([event('s1', 1)]);
  });

  it('only delivers events for the subscribed subscriptionId', () => {
    const hub = new QuoteStreamHub();
    const received: SymbolQuoteEvent[] = [];
    hub.subscribe('s1', (e) => received.push(e));

    hub.publish(event('s2', 1));

    expect(received).toEqual([]);
  });

  it('stops delivering after unsubscribe', () => {
    const hub = new QuoteStreamHub();
    const received: SymbolQuoteEvent[] = [];
    const unsubscribe = hub.subscribe('s1', (e) => received.push(e));

    unsubscribe();
    hub.publish(event('s1', 1));

    expect(received).toEqual([]);
  });

  it('publishing with no subscribers is a no-op', () => {
    const hub = new QuoteStreamHub();
    expect(() => hub.publish(event('s1', 1))).not.toThrow();
  });
});
