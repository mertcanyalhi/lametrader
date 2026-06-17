import { MarketDataError, Period, SymbolType } from '@lametrader/core';
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

  it("drops Yahoo's trailing live-stamped duplicate of the in-progress bar", async () => {
    const HOUR = 3_600_000;
    const quote = (time: number, close: number) => ({
      date: new Date(time),
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 100,
      adjclose: close,
    });
    // Aligned hourly bars, then a trailing quote stamped 55 min into the last
    // bar's period (Yahoo's live update time) — the duplicate to drop.
    vi.spyOn(YahooFinance.prototype, 'chart').mockResolvedValue({
      quotes: [
        quote(3 * HOUR, 10),
        quote(4 * HOUR, 11),
        quote(5 * HOUR, 12),
        quote(5 * HOUR + 55 * 60_000, 12.5),
      ],
    } as never);
    const source = new YahooMarketDataSource();

    const candle = (time: number, close: number) => ({
      type: SymbolType.Stock,
      time,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 100,
      adjClose: close,
    });
    await expect(source.fetchCandles('stock:AAPL', Period.OneHour)).resolves.toEqual({
      candles: [candle(3 * HOUR, 10), candle(4 * HOUR, 11), candle(5 * HOUR, 12)],
      complete: true,
    });
  });

  it('leaves an already-aligned series unchanged (no trailing duplicate)', async () => {
    const HOUR = 3_600_000;
    const quote = (time: number, close: number) => ({
      date: new Date(time),
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 100,
      adjclose: close,
    });
    vi.spyOn(YahooFinance.prototype, 'chart').mockResolvedValue({
      quotes: [quote(3 * HOUR, 10), quote(4 * HOUR, 11), quote(5 * HOUR, 12)],
    } as never);
    const source = new YahooMarketDataSource();

    const candle = (time: number, close: number) => ({
      type: SymbolType.Stock,
      time,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 100,
      adjClose: close,
    });
    await expect(source.fetchCandles('stock:AAPL', Period.OneHour)).resolves.toEqual({
      candles: [candle(3 * HOUR, 10), candle(4 * HOUR, 11), candle(5 * HOUR, 12)],
      complete: true,
    });
  });
});
