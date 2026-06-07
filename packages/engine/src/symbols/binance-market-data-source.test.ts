import { MarketDataError, Period } from '@lametrader/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BinanceMarketDataSource } from './binance-market-data-source.js';

describe('BinanceMarketDataSource.fetchCandles', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('wraps an upstream HTTP failure in a MarketDataError carrying the cause', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 418, statusText: "I'm a teapot" }) as Response),
    );
    const source = new BinanceMarketDataSource();

    await expect(source.fetchCandles('crypto:BTCUSDT', Period.OneHour)).rejects.toThrowError(
      MarketDataError,
    );
    await expect(source.fetchCandles('crypto:BTCUSDT', Period.OneHour)).rejects.toThrowError(
      /Binance failed to fetch candles for crypto:BTCUSDT: Binance 418/,
    );
  });
});
