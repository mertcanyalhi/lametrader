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

  it('merges Yahoo trailing live row into the aligned in-progress bar (running high/low, live close)', async () => {
    const HOUR = 3_600_000;
    // Aligned hourly bars with accumulated data, then Yahoo's trailing live
    // snapshot 55 min into the current hour: a new high (14) and the latest
    // close (13), carrying no volume of its own (V=0), as the real API does.
    vi.spyOn(YahooFinance.prototype, 'chart').mockResolvedValue({
      quotes: [
        {
          date: new Date(3 * HOUR),
          open: 10,
          high: 11,
          low: 9,
          close: 10,
          volume: 100,
          adjclose: 10,
        },
        {
          date: new Date(4 * HOUR),
          open: 11,
          high: 12,
          low: 10,
          close: 11,
          volume: 100,
          adjclose: 11,
        },
        {
          date: new Date(5 * HOUR),
          open: 12,
          high: 13,
          low: 11,
          close: 12,
          volume: 100,
          adjclose: 12,
        },
        {
          date: new Date(5 * HOUR + 55 * 60_000),
          open: 12.5,
          high: 14,
          low: 10,
          close: 13,
          volume: 0,
          adjclose: 13,
        },
      ],
    } as never);
    const source = new YahooMarketDataSource();

    await expect(source.fetchCandles('stock:AAPL', Period.OneHour)).resolves.toEqual({
      candles: [
        {
          type: SymbolType.Stock,
          time: 3 * HOUR,
          open: 10,
          high: 11,
          low: 9,
          close: 10,
          volume: 100,
          adjClose: 10,
        },
        {
          type: SymbolType.Stock,
          time: 4 * HOUR,
          open: 11,
          high: 12,
          low: 10,
          close: 11,
          volume: 100,
          adjClose: 11,
        },
        {
          type: SymbolType.Stock,
          time: 5 * HOUR,
          open: 12,
          high: 14,
          low: 10,
          close: 13,
          volume: 100,
          adjClose: 13,
        },
      ],
      complete: true,
    });
  });

  it('fills a null-OHLC aligned current-period bar from the trailing live row', async () => {
    const MIN = 60_000;
    // Yahoo leaves the aligned current-minute bar all-null until it closes,
    // carrying the live price only on a trailing snapshot 44s in — the exact
    // 1m case that scattered sub-minute rows before the merge.
    vi.spyOn(YahooFinance.prototype, 'chart').mockResolvedValue({
      quotes: [
        {
          date: new Date(3 * MIN),
          open: 10,
          high: 11,
          low: 9,
          close: 10,
          volume: 50,
          adjclose: 10,
        },
        {
          date: new Date(4 * MIN),
          open: 11,
          high: 12,
          low: 10,
          close: 11,
          volume: 50,
          adjclose: 11,
        },
        {
          date: new Date(5 * MIN),
          open: null,
          high: null,
          low: null,
          close: null,
          volume: null,
          adjclose: null,
        },
        {
          date: new Date(5 * MIN + 44_000),
          open: 12.5,
          high: 12.5,
          low: 12.5,
          close: 12.5,
          volume: 0,
          adjclose: 12.5,
        },
      ],
    } as never);
    const source = new YahooMarketDataSource();

    await expect(source.fetchCandles('stock:AAPL', Period.OneMinute)).resolves.toEqual({
      candles: [
        {
          type: SymbolType.Stock,
          time: 3 * MIN,
          open: 10,
          high: 11,
          low: 9,
          close: 10,
          volume: 50,
          adjClose: 10,
        },
        {
          type: SymbolType.Stock,
          time: 4 * MIN,
          open: 11,
          high: 12,
          low: 10,
          close: 11,
          volume: 50,
          adjClose: 11,
        },
        {
          type: SymbolType.Stock,
          time: 5 * MIN,
          open: 12.5,
          high: 12.5,
          low: 12.5,
          close: 12.5,
          volume: 0,
          adjClose: 12.5,
        },
      ],
      complete: true,
    });
  });

  it('leaves an already-aligned series unchanged (no sub-period trailing row)', async () => {
    const HOUR = 3_600_000;
    vi.spyOn(YahooFinance.prototype, 'chart').mockResolvedValue({
      quotes: [
        {
          date: new Date(3 * HOUR),
          open: 10,
          high: 11,
          low: 9,
          close: 10,
          volume: 100,
          adjclose: 10,
        },
        {
          date: new Date(4 * HOUR),
          open: 11,
          high: 12,
          low: 10,
          close: 11,
          volume: 100,
          adjclose: 11,
        },
        {
          date: new Date(5 * HOUR),
          open: 12,
          high: 13,
          low: 11,
          close: 12,
          volume: 100,
          adjclose: 12,
        },
      ],
    } as never);
    const source = new YahooMarketDataSource();

    await expect(source.fetchCandles('stock:AAPL', Period.OneHour)).resolves.toEqual({
      candles: [
        {
          type: SymbolType.Stock,
          time: 3 * HOUR,
          open: 10,
          high: 11,
          low: 9,
          close: 10,
          volume: 100,
          adjClose: 10,
        },
        {
          type: SymbolType.Stock,
          time: 4 * HOUR,
          open: 11,
          high: 12,
          low: 10,
          close: 11,
          volume: 100,
          adjClose: 11,
        },
        {
          type: SymbolType.Stock,
          time: 5 * HOUR,
          open: 12,
          high: 13,
          low: 11,
          close: 12,
          volume: 100,
          adjClose: 12,
        },
      ],
      complete: true,
    });
  });
});
