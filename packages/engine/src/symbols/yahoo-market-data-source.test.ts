import { MarketDataError, Period } from '@lametrader/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import YahooFinance from 'yahoo-finance2';
import { YahooMarketDataSource } from './yahoo-market-data-source.js';

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
