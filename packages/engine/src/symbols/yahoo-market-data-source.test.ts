import { MarketDataError, Period } from '@lametrader/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import YahooFinance from 'yahoo-finance2';
import { resolveYahooChartRange, YahooMarketDataSource } from './yahoo-market-data-source.js';

/** A fixed clock so lookback windows are deterministic. */
const NOW = 1_000_000_000_000;
/** One day in ms. */
const DAY = 86_400_000;

describe('resolveYahooChartRange', () => {
  it('uses a bounded lookback for an intraday interval with no range (not epoch 0)', () => {
    expect(resolveYahooChartRange(Period.OneMinute, undefined, NOW)).toEqual({
      period1: new Date(NOW - 7 * DAY),
      period2: new Date(NOW),
    });
  });

  it('uses epoch 0 (full history) for a daily interval with no range', () => {
    expect(resolveYahooChartRange(Period.OneDay, undefined, NOW)).toEqual({
      period1: new Date(0),
      period2: new Date(NOW),
    });
  });

  it('uses the explicit range bounds when a range is given', () => {
    expect(resolveYahooChartRange(Period.OneMinute, { from: 100, to: 200 }, NOW)).toEqual({
      period1: new Date(100),
      period2: new Date(200),
    });
  });
});

/** Build an error carrying an HTTP status, as `yahoo-finance2` does on a non-2xx. */
const httpError = (code: number): Error => Object.assign(new Error(`HTTP ${code}`), { code });

describe('YahooMarketDataSource.lookup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when Yahoo rejects the symbol with a 4xx', async () => {
    vi.spyOn(YahooFinance.prototype, 'quote').mockRejectedValue(httpError(404));
    const source = new YahooMarketDataSource();

    expect(await source.lookup('stock:NOPE')).toBeNull();
  });

  it('throws MarketDataError on a 5xx upstream failure', async () => {
    vi.spyOn(YahooFinance.prototype, 'quote').mockRejectedValue(httpError(503));
    const source = new YahooMarketDataSource();

    await expect(source.lookup('stock:AAPL')).rejects.toThrowError(MarketDataError);
  });

  it('throws MarketDataError on a network error with no HTTP status', async () => {
    vi.spyOn(YahooFinance.prototype, 'quote').mockRejectedValue(new Error('ECONNRESET'));
    const source = new YahooMarketDataSource();

    await expect(source.lookup('stock:AAPL')).rejects.toThrowError(MarketDataError);
  });
});

describe('YahooMarketDataSource.fetchCandles', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('wraps an upstream provider failure in a MarketDataError carrying the cause', async () => {
    vi.spyOn(YahooFinance.prototype, 'chart').mockRejectedValue(
      new Error("Data doesn't exist for startDate = 1591957, endDate = 1781260"),
    );
    const source = new YahooMarketDataSource();

    await expect(source.fetchCandles('stock:AAPL', Period.OneHour)).rejects.toThrowError(
      MarketDataError,
    );
    await expect(source.fetchCandles('stock:AAPL', Period.OneHour)).rejects.toThrowError(
      /Yahoo failed to fetch candles for stock:AAPL: Data doesn't exist/,
    );
  });
});
