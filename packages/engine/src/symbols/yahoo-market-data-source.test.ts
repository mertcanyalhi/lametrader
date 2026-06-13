import { MarketDataError, Period } from '@lametrader/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import YahooFinance from 'yahoo-finance2';
import { YahooMarketDataSource } from './yahoo-market-data-source.js';

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
