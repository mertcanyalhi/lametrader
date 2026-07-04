import type { BaseCandle } from '@lametrader/core';
import { computeQuote } from './quote.js';

/** Build a bare OHLC candle at `time` closing at `close`. */
const bar = (time: number, close: number): BaseCandle => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
});

describe('computeQuote', () => {
  it('derives price/change/changePct/time for a rising latest-vs-previous pair', () => {
    expect(computeQuote(bar(2000, 101.23), bar(1000, 100))).toEqual({
      price: 101.23,
      change: expect.closeTo(1.23, 5),
      changePct: expect.closeTo(0.0123, 5),
      time: 2000,
    });
  });

  it('derives a negative change and changePct for a falling latest-vs-previous pair', () => {
    expect(computeQuote(bar(2000, 98), bar(1000, 100))).toEqual({
      price: 98,
      change: expect.closeTo(-2, 5),
      changePct: expect.closeTo(-0.02, 5),
      time: 2000,
    });
  });

  it('yields changePct 0 (not Infinity/NaN) when the previous close is 0', () => {
    expect(computeQuote(bar(2000, 5), bar(1000, 0))).toEqual({
      price: 5,
      change: expect.closeTo(5, 5),
      changePct: 0,
      time: 2000,
    });
  });
});
