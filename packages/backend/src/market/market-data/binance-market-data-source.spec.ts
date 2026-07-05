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

  it('walks the full history forward to the newest kline, past the old 50-page bound', async () => {
    // 60 full pages (beyond the removed 50-page cap) then a short page ends it,
    // each page continuing where the last left off — the newest candle is reached.
    const FULL_PAGES = 60;
    let call = 0;
    globalThis.fetch = jest.fn(async () => {
      const base = call * 1000 + 1;
      const rows =
        call < FULL_PAGES
          ? Array.from({ length: 1000 }, (_, i) => klineRow(base + i))
          : [klineRow(base)];
      call += 1;
      return { ok: true, json: async () => rows } as Response;
    }) as unknown as typeof fetch;
    const source = new BinanceMarketDataSource();

    const batch = await source.fetchCandles('crypto:BTCUSDT', Period.OneHour);

    expect(batch.complete).toBe(true);
    expect(batch.candles.length).toBe(FULL_PAGES * 1000 + 1);
    expect(batch.candles.at(0)?.time).toBe(1);
    expect(batch.candles.at(-1)?.time).toBe(FULL_PAGES * 1000 + 1);
  });

  it('pages forward within an explicit range, bounded by the requested end', async () => {
    // A window `[100, 250)`: one page of rows at 100..1099, cut off at `to`.
    const rows = Array.from({ length: 1000 }, (_, i) => klineRow(100 + i));
    const urls: string[] = [];
    globalThis.fetch = jest.fn(async (url: string) => {
      urls.push(url);
      return { ok: true, json: async () => rows } as Response;
    }) as unknown as typeof fetch;
    const source = new BinanceMarketDataSource();

    const batch = await source.fetchCandles('crypto:BTCUSDT', Period.OneHour, {
      from: 100,
      to: 250,
    });

    expect(batch.complete).toBe(true);
    expect(batch.candles.length).toBe(150);
    expect(batch.candles.at(0)?.time).toBe(100);
    expect(batch.candles.at(-1)?.time).toBe(249);
    expect(urls[0]?.includes('startTime=100')).toBe(true);
    expect(urls[0]?.includes('endTime=250')).toBe(true);
  });

  it('reports retrieval progress per page against an estimate from the first page', async () => {
    const HOUR = 3_600_000;
    // Two full pages (earliest candle at t=0) then a short page ends history.
    const p1 = Array.from({ length: 1000 }, (_, i) => klineRow(i * HOUR));
    const p2 = Array.from({ length: 1000 }, (_, i) => klineRow((1000 + i) * HOUR));
    const p3 = [klineRow(2000 * HOUR)];
    let call = 0;
    globalThis.fetch = jest.fn(async () => {
      const rows = [p1, p2, p3][Math.min(call, 2)];
      call += 1;
      return { ok: true, json: async () => rows } as Response;
    }) as unknown as typeof fetch;
    const source = new BinanceMarketDataSource();
    const frames: Array<[number, number]> = [];

    await source.fetchCandles(
      'crypto:BTCUSDT',
      Period.OneHour,
      { from: 0, to: 3000 * HOUR },
      (done, total) => frames.push([done, total]),
    );

    // total estimate = ceil((to − earliest) / 1h) = 3000; done is cumulative.
    expect(frames).toEqual([
      [1000, 3000],
      [2000, 3000],
      [2001, 3000],
    ]);
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
