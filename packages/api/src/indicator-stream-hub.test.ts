import type { IndicatorStateEvent } from '@lametrader/core';
import { Period } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { IndicatorStreamHub } from './indicator-stream-hub.js';

const event = (subscriptionId: string, time: number): IndicatorStateEvent => ({
  subscriptionId,
  id: 'crypto:BTCUSDT',
  period: Period.OneHour,
  indicatorKey: 'sma',
  state: { time, value: 42 },
  final: true,
});

describe('IndicatorStreamHub', () => {
  it('fans an event to every subscriber of its subscriptionId', () => {
    const hub = new IndicatorStreamHub();
    const received: IndicatorStateEvent[] = [];
    hub.subscribe('s1', (e) => received.push(e));

    hub.publish(event('s1', 1));

    expect(received).toEqual([event('s1', 1)]);
  });

  it('only delivers events for the subscribed subscriptionId', () => {
    const hub = new IndicatorStreamHub();
    const received: IndicatorStateEvent[] = [];
    hub.subscribe('s1', (e) => received.push(e));

    hub.publish(event('s2', 1));

    expect(received).toEqual([]);
  });

  it('stops delivering after unsubscribe', () => {
    const hub = new IndicatorStreamHub();
    const received: IndicatorStateEvent[] = [];
    const unsubscribe = hub.subscribe('s1', (e) => received.push(e));

    unsubscribe();
    hub.publish(event('s1', 1));

    expect(received).toEqual([]);
  });

  it('publishing with no subscribers is a no-op', () => {
    const hub = new IndicatorStreamHub();
    expect(() => hub.publish(event('s1', 1))).not.toThrow();
  });
});
