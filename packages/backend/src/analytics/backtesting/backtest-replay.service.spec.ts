import { type Candle, Period, SymbolType } from '@lametrader/core';
import {
  emptyBacktestSummary,
  type FeedCandle,
  orderBacktestFeed,
  progressAt,
} from './backtest-replay.service.js';

/** A crypto candle at `time` with flat OHLC — enough for feed ordering. */
const candle = (time: number): Candle => ({
  type: SymbolType.Crypto,
  time,
  open: 100,
  high: 100,
  low: 100,
  close: 100,
  volume: 1,
  quoteVolume: 100,
  trades: 1,
});

describe('orderBacktestFeed', () => {
  it('orders candles by completion time, ties finest-period-first', () => {
    const ordered = orderBacktestFeed([
      { period: Period.OneMinute, candles: [candle(0), candle(240_000)] },
      { period: Period.FiveMinutes, candles: [candle(0)] },
    ]);
    expect(ordered).toEqual<FeedCandle[]>([
      { period: Period.OneMinute, candle: candle(0) },
      { period: Period.OneMinute, candle: candle(240_000) },
      { period: Period.FiveMinutes, candle: candle(0) },
    ]);
  });
});

describe('progressAt', () => {
  it('reports elapsed replay days to the candle completion over total days', () => {
    const item: FeedCandle = { period: Period.OneMinute, candle: candle(240_000) };
    expect(progressAt(item, { start: 0, end: 86_400_000 }, 1)).toEqual({
      elapsedDays: expect.closeTo(300_000 / 86_400_000, 10),
      totalDays: 1,
    });
  });

  it('clamps elapsed days to the total window', () => {
    const item: FeedCandle = { period: Period.OneDay, candle: candle(86_400_000) };
    expect(progressAt(item, { start: 0, end: 86_400_000 }, 1)).toEqual({
      elapsedDays: 1,
      totalDays: 1,
    });
  });
});

describe('emptyBacktestSummary', () => {
  it('is a zeroed summary (no trades yet in this slice)', () => {
    expect(emptyBacktestSummary()).toEqual({
      totalPnl: 0,
      roiPct: 0,
      avgPnlPerTrade: 0,
      tradeCount: 0,
      winners: 0,
      losers: 0,
      avgRoiPct: 0,
      avgDaysInTrade: 0,
    });
  });
});
