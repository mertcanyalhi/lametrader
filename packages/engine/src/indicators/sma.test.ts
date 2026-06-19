import { type Candle, PriceSource, SymbolType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { defaultIndicators } from './default-indicators.js';
import { movingAverage } from './sma.js';

/** Build a crypto candle at `time` with `close`; other OHLC values are irrelevant for SMA(close). */
const candle = (time: number, close: number): Candle => ({
  type: SymbolType.Crypto,
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 0,
  quoteVolume: 0,
  trades: 0,
});

describe('movingAverage.compute', () => {
  it('returns an aligned SMA series with the first length-1 rows null (warm-up)', () => {
    const candles = [10, 20, 30, 40, 50].map((close, i) => candle(i, close));
    expect(movingAverage.compute({ length: 3, source: PriceSource.Close }, candles)).toEqual([
      { time: 0, value: null },
      { time: 1, value: null },
      { time: 2, value: expect.closeTo(20, 6) },
      { time: 3, value: expect.closeTo(30, 6) },
      { time: 4, value: expect.closeTo(40, 6) },
    ]);
  });

  it('returns an all-null series when the input is shorter than length (silent)', () => {
    const candles = [10, 20].map((close, i) => candle(i, close));
    expect(movingAverage.compute({ length: 5, source: PriceSource.Close }, candles)).toEqual([
      { time: 0, value: null },
      { time: 1, value: null },
    ]);
  });

  it('does not use look-ahead: the state at bar t is identical for [0..t] vs [0..t+k]', () => {
    const candles = [10, 20, 30, 40, 50].map((close, i) => candle(i, close));
    const truncated = movingAverage.compute(
      { length: 3, source: PriceSource.Close },
      candles.slice(0, 3),
    );
    const full = movingAverage.compute({ length: 3, source: PriceSource.Close }, candles);
    expect(truncated).toEqual(full.slice(0, 3));
  });
});

describe('movingAverage.definition', () => {
  it('is JSON-serializable (no functions leak into the metadata)', () => {
    const roundTripped = JSON.parse(JSON.stringify(movingAverage.definition));
    expect(roundTripped).toEqual(movingAverage.definition);
  });
});

describe('movingAverage.warmup', () => {
  it('returns `length` bars — the count the compute service needs before the first non-null row', () => {
    expect(movingAverage.warmup?.({ length: 14, source: PriceSource.Close })).toEqual(14);
  });
});

describe('defaultIndicators', () => {
  it('returns a registry containing the moving-average module', () => {
    const registry = defaultIndicators();
    expect(registry.get('sma')).toEqual(movingAverage);
    expect(registry.list().map((d) => d.key)).toContain('sma');
  });
});
