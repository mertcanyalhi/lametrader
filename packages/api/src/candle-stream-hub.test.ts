import { type CryptoCandle, Period, SymbolType } from '@lametrader/core';
import type { CandleEvent } from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { CandleStreamHub } from './candle-stream-hub.js';

/** Build a crypto candle at `time`. */
const candle = (time: number): CryptoCandle => ({
  type: SymbolType.Crypto,
  time,
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
  volume: 10,
  quoteVolume: 15,
  trades: 3,
});

/** A representative streamed candle event. */
const EVENT: CandleEvent = {
  id: 'crypto:BTCUSDT',
  period: Period.OneHour,
  candle: candle(1000),
  final: false,
};

describe('CandleStreamHub', () => {
  it('fans a published event out to every subscriber of its id', () => {
    const hub = new CandleStreamHub();
    const a: CandleEvent[] = [];
    const b: CandleEvent[] = [];
    hub.subscribe('crypto:BTCUSDT', (event) => a.push(event));
    hub.subscribe('crypto:BTCUSDT', (event) => b.push(event));

    hub.publish(EVENT);

    expect(a).toEqual([EVENT]);
    expect(b).toEqual([EVENT]);
  });

  it('only delivers events for the subscribed id', () => {
    const hub = new CandleStreamHub();
    const events: CandleEvent[] = [];
    hub.subscribe('crypto:BTCUSDT', (event) => events.push(event));

    hub.publish({ ...EVENT, id: 'stock:AAPL' });

    expect(events).toEqual([]);
  });

  it('stops delivering after unsubscribe', () => {
    const hub = new CandleStreamHub();
    const events: CandleEvent[] = [];
    const unsubscribe = hub.subscribe('crypto:BTCUSDT', (event) => events.push(event));

    unsubscribe();
    hub.publish(EVENT);

    expect(events).toEqual([]);
  });

  it('publishing with no subscribers is a no-op', () => {
    const hub = new CandleStreamHub();
    expect(() => hub.publish(EVENT)).not.toThrow();
  });
});
