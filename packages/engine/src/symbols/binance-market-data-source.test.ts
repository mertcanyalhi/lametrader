import { CandleError, MarketDataError, Period } from '@lametrader/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BinanceMarketDataSource } from './binance-market-data-source.js';

describe('BinanceMarketDataSource.fetchCandles', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects a period Binance has no kline interval for, without a network call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const source = new BinanceMarketDataSource();

    // A value outside the supported Period set (cast to simulate a future enum
    // member Binance does not offer).
    await expect(source.fetchCandles('crypto:BTCUSDT', '2h' as Period)).rejects.toThrowError(
      CandleError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
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
