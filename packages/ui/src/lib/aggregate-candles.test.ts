import { type Candle, Period, periodMillis, SymbolType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { formingBucketCandle } from './aggregate-candles.js';

/** The 1h bucket the aggregation folds smaller bars into. */
const HOUR = periodMillis(Period.OneHour);
/** A 15m step — the smaller period being folded up. */
const Q = periodMillis(Period.FifteenMinutes);
/** A bucket start on an exact 1h boundary. */
const BUCKET = Date.UTC(2024, 5, 1, 12, 0, 0);

/**
 * Build a crypto candle at `time` with explicit OHLCV so each test asserts the
 * exact fold. Defaults give distinct O/H/L/C so `open`/`close` selection and
 * `high`/`low` extremes are visible.
 */
const candle = (
  time: number,
  over: Partial<Omit<Candle & { type: SymbolType.Crypto }, 'type' | 'time'>> = {},
): Candle => ({
  type: SymbolType.Crypto,
  time,
  open: 100,
  high: 110,
  low: 90,
  close: 105,
  volume: 10,
  quoteVolume: 1000,
  trades: 5,
  ...over,
});

describe('formingBucketCandle', () => {
  it('folds multiple smaller candles in one bucket into a single forming bar', () => {
    const candles: Candle[] = [
      candle(BUCKET, { open: 100, high: 108, low: 95, close: 103, volume: 4 }),
      candle(BUCKET + Q, { open: 103, high: 115, low: 101, close: 112, volume: 6 }),
      candle(BUCKET + 2 * Q, { open: 112, high: 113, low: 88, close: 90, volume: 5 }),
    ];

    expect(formingBucketCandle(candles, Period.OneHour)).toEqual({
      type: SymbolType.Crypto,
      time: BUCKET,
      open: 100,
      high: 115,
      low: 88,
      close: 90,
      volume: 15,
      quoteVolume: 3000,
      trades: 15,
    });
  });

  it('returns the single in-bucket candle re-timed to the bucket start', () => {
    const candles: Candle[] = [
      candle(BUCKET + 2 * Q, { open: 100, high: 120, low: 80, close: 110, volume: 7 }),
    ];

    expect(formingBucketCandle(candles, Period.OneHour)).toEqual({
      type: SymbolType.Crypto,
      time: BUCKET,
      open: 100,
      high: 120,
      low: 80,
      close: 110,
      volume: 7,
      quoteVolume: 1000,
      trades: 5,
    });
  });

  it('returns null for empty input', () => {
    expect(formingBucketCandle([], Period.OneHour)).toEqual(null);
  });

  it('folds only the most-recent bucket, excluding candles in an earlier bucket', () => {
    const candles: Candle[] = [
      candle(BUCKET - HOUR, { open: 50, high: 60, low: 40, close: 55, volume: 99 }),
      candle(BUCKET, { open: 100, high: 108, low: 95, close: 103, volume: 4 }),
      candle(BUCKET + Q, { open: 103, high: 115, low: 101, close: 112, volume: 6 }),
    ];

    expect(formingBucketCandle(candles, Period.OneHour)).toEqual({
      type: SymbolType.Crypto,
      time: BUCKET,
      open: 100,
      high: 115,
      low: 95,
      close: 112,
      volume: 10,
      quoteVolume: 2000,
      trades: 10,
    });
  });

  it('floors the latest candle time to the period boundary as the bucket start', () => {
    const latest = BUCKET + 3 * Q + 137;
    const candles: Candle[] = [candle(latest, { open: 100, high: 111, low: 90, close: 108 })];

    expect(formingBucketCandle(candles, Period.OneHour)).toEqual({
      type: SymbolType.Crypto,
      time: BUCKET,
      open: 100,
      high: 111,
      low: 90,
      close: 108,
      volume: 10,
      quoteVolume: 1000,
      trades: 5,
    });
  });

  it('carries a volume-less FX candle through with no volume fields', () => {
    const fx: Candle = {
      type: SymbolType.Fx,
      time: BUCKET + Q,
      open: 1.1,
      high: 1.2,
      low: 1.05,
      close: 1.15,
    };

    expect(formingBucketCandle([fx], Period.OneHour)).toEqual({
      type: SymbolType.Fx,
      time: BUCKET,
      open: 1.1,
      high: 1.2,
      low: 1.05,
      close: 1.15,
    });
  });
});
