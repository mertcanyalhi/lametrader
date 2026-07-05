import { Period } from '@lametrader/core';
import { CandleError } from '../../common/domain/candle.js';
import { MarketDataError } from '../../common/domain/symbol.js';
import { BinanceMarketDataSource } from './binance-market-data-source.js';

/** One hour in ms — the 1h period `fetchCandles` partitions windows by. */
const HOUR = 3_600_000;

/** A Binance kline row with the open time `t`; other fields are filler. */
const klineRow = (t: number) => [t, '1', '2', '0.5', '1.5', '10', t + 1, '15', 3];

/** `n` consecutive hourly kline rows starting at `t=0`. */
const hourlySeries = (n: number): number[][] =>
  Array.from({ length: n }, (_, i) => klineRow(i * HOUR));

/** The real global fetch, restored after each test that stubs it. */
const realFetch = globalThis.fetch;

/**
 * Stub global fetch to serve klines from a fixed ascending `series`, honoring the
 * request's `startTime`/`endTime`/`limit` (so it answers the earliest-probe and
 * every window request by URL, not by call order). Records the `startTime` of each
 * window request (`limit=1000`) so a test can assert the windows fetched.
 */
function stubKlines(series: number[][]): { urls: string[]; windowStarts: number[] } {
  const urls: string[] = [];
  const windowStarts: number[] = [];
  globalThis.fetch = jest.fn(async (url: string) => {
    urls.push(url);
    const params = new URL(url).searchParams;
    const startTime = Number(params.get('startTime'));
    const endParam = params.get('endTime');
    const endTime = endParam === null ? Number.POSITIVE_INFINITY : Number(endParam);
    const limit = Number(params.get('limit'));
    if (limit === 1000) windowStarts.push(startTime);
    const rows = series.filter((r) => (r[0] as number) >= startTime && (r[0] as number) <= endTime);
    return { ok: true, json: async () => rows.slice(0, limit) } as Response;
  }) as unknown as typeof fetch;
  return { urls, windowStarts };
}

/** A source with a fixed clock and an instant (no-wait) backoff, for hermetic tests. */
const sourceAt = (now: number): BinanceMarketDataSource =>
  new BinanceMarketDataSource(
    () => now,
    () => Promise.resolve(),
  );

describe('BinanceMarketDataSource.fetchCandles', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('probes the earliest kline, partitions the span into windows, and returns them sorted', async () => {
    // 1500 hourly candles ⇒ two windows ([0..999h] then [1000h..1499h]).
    stubKlines(hourlySeries(1500));
    const source = sourceAt(1500 * HOUR);

    const batch = await source.fetchCandles('crypto:BTCUSDT', Period.OneHour);

    expect(batch.complete).toBe(true);
    expect(batch.candles.length).toBe(1500);
    expect(batch.candles.at(0)?.time).toBe(0);
    expect(batch.candles.at(-1)?.time).toBe(1499 * HOUR);
  });

  it('fetches each window of the span (by startTime), not a serial cursor chain', async () => {
    const stub = stubKlines(hourlySeries(1500));
    const source = sourceAt(1500 * HOUR);

    await source.fetchCandles('crypto:BTCUSDT', Period.OneHour);

    // One window per KLINES_LIMIT×1h stride across [0, 1500h): starts at 0 and 1000h.
    expect(stub.windowStarts).toEqual([0, 1000 * HOUR]);
  });

  it('reports the exact up-front total and a cumulative done as windows land', async () => {
    stubKlines(hourlySeries(1500));
    const source = sourceAt(1500 * HOUR);
    const frames: Array<[number, number]> = [];

    await source.fetchCandles('crypto:BTCUSDT', Period.OneHour, undefined, (done, total) =>
      frames.push([done, total]),
    );

    // total = ceil((1500h − 0) / 1h) = 1500; done accrues per completed window.
    expect(frames).toEqual([
      [1000, 1500],
      [1500, 1500],
    ]);
  });

  it('retries a 429 after its Retry-After then succeeds', async () => {
    let rateLimited = false;
    const series = hourlySeries(3);
    globalThis.fetch = jest.fn(async (url: string) => {
      if (!rateLimited) {
        rateLimited = true;
        return {
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: { get: () => '0' },
        } as unknown as Response;
      }
      const params = new URL(url).searchParams;
      const startTime = Number(params.get('startTime'));
      const limit = Number(params.get('limit'));
      const rows = series.filter((r) => (r[0] as number) >= startTime);
      return { ok: true, json: async () => rows.slice(0, limit) } as Response;
    }) as unknown as typeof fetch;
    const source = sourceAt(3 * HOUR);

    const batch = await source.fetchCandles('crypto:BTCUSDT', Period.OneHour);

    expect(batch.candles.length).toBe(3);
  });

  it('wraps a 429 that never clears in a MarketDataError', async () => {
    globalThis.fetch = jest.fn(
      async () =>
        ({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: { get: () => null },
        }) as unknown as Response,
    ) as unknown as typeof fetch;
    const source = sourceAt(3 * HOUR);

    await expect(source.fetchCandles('crypto:BTCUSDT', Period.OneHour)).rejects.toThrow(
      MarketDataError,
    );
  });

  it('partitions an explicit range and drops candles outside [from, to)', async () => {
    // Series spans 0..5h; the range keeps only [1h, 4h).
    const stub = stubKlines(hourlySeries(6));
    const source = sourceAt(10 * HOUR);

    const batch = await source.fetchCandles('crypto:BTCUSDT', Period.OneHour, {
      from: HOUR,
      to: 4 * HOUR,
    });

    expect(batch.candles.map((c) => c.time)).toEqual([HOUR, 2 * HOUR, 3 * HOUR]);
    // A ranged fetch bounds the span directly — no earliest probe (limit=1).
    expect(stub.urls.some((u) => u.endsWith('limit=1'))).toBe(false);
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
      async () =>
        ({
          ok: false,
          status: 418,
          statusText: "I'm a teapot",
          headers: { get: () => null },
        }) as unknown as Response,
    ) as unknown as typeof fetch;
    const source = sourceAt(3 * HOUR);

    await expect(source.fetchCandles('crypto:BTCUSDT', Period.OneHour)).rejects.toThrow(
      /Binance failed to fetch candles for crypto:BTCUSDT: Binance 418/,
    );
  });
});
