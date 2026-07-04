import { Period } from '@lametrader/core';
import { CandleError } from '../../common/domain/candle.js';
import { MarketDataError } from '../../common/domain/symbol.js';
import { BinanceMarketDataSource } from './binance-market-data-source.js';

/** A Binance kline row with the open time `t`; other fields are filler. */
const klineRow = (t: number) => [t, '1', '2', '0.5', '1.5', '10', t + 1, '15', 3];

/** The real global fetch, restored after each test that stubs it. */
const realFetch = globalThis.fetch;

/** Stub global fetch to return `pages`, one full/partial kline page per call. */
const stubKlinePages = (pages: number[][][]): void => {
  let call = 0;
  globalThis.fetch = jest.fn(async () => {
    const rows = pages[Math.min(call, pages.length - 1)] ?? [];
    call += 1;
    return { ok: true, json: async () => rows } as Response;
  }) as unknown as typeof fetch;
};

describe('BinanceMarketDataSource.fetchCandles', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('reports complete: true when a short final page ends the history', async () => {
    // One full page (1000) then a partial page → natural end.
    const full = Array.from({ length: 1000 }, (_, i) => klineRow(i + 1));
    const tail = [klineRow(2000)];
    stubKlinePages([full, tail]);
    const source = new BinanceMarketDataSource();

    const batch = await source.fetchCandles('crypto:BTCUSDT', Period.OneHour);
    expect(batch.complete).toBe(true);
    expect(batch.candles.length).toBe(1001);
  });

  it('reports complete: false when the page cap is hit with full pages remaining', async () => {
    // Every page is full (1000) → the MAX_PAGES cap stops a still-growing fetch.
    const full = Array.from({ length: 1000 }, (_, i) => klineRow(i + 1));
    stubKlinePages([full]);
    const source = new BinanceMarketDataSource();

    const batch = await source.fetchCandles('crypto:BTCUSDT', Period.OneHour);
    expect(batch.complete).toBe(false);
  });

  it('rejects a period Binance has no kline interval for, without a network call', async () => {
    const fetchSpy = jest.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const source = new BinanceMarketDataSource();

    // A value outside the supported Period set (cast to simulate a future enum
    // member Binance does not offer).
    await expect(source.fetchCandles('crypto:BTCUSDT', '2h' as Period)).rejects.toThrow(
      CandleError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('wraps an upstream HTTP failure in a MarketDataError carrying the cause', async () => {
    globalThis.fetch = jest.fn(
      async () => ({ ok: false, status: 418, statusText: "I'm a teapot" }) as Response,
    ) as unknown as typeof fetch;
    const source = new BinanceMarketDataSource();

    await expect(source.fetchCandles('crypto:BTCUSDT', Period.OneHour)).rejects.toThrow(
      MarketDataError,
    );
    await expect(source.fetchCandles('crypto:BTCUSDT', Period.OneHour)).rejects.toThrow(
      /Binance failed to fetch candles for crypto:BTCUSDT: Binance 418/,
    );
  });
});
