import {
  type Candle,
  type CandleRepository,
  Period,
  periodMillis,
  SymbolType,
} from '@lametrader/core';
import { InMemoryCandleRepository } from '../../market/persistence/in-memory-candle.repository.js';
import { type FeedCandle, orderBacktestFeed } from './backtest-replay.service.js';
import { completionKey, lessThan, streamFeed } from './stream-feed.js';

/** The single symbol every fixture streams. */
const SYMBOL = 'BTCUSDT';

/** A crypto candle at `time` with flat OHLC — enough for feed ordering. */
const candle = (time: number): Candle => ({
  type: SymbolType.Crypto,
  time,
  open: 100,
  high: 100,
  low: 100,
  close: 100,
  volume: 1,
  quoteVolume: 100,
  trades: 1,
});

/**
 * `count` consecutive candles on `period`, opening at `0, periodMillis, …` —
 * a gapless run for chunk-boundary fixtures.
 */
const consecutive = (period: Period, count: number): Candle[] => {
  const out: Candle[] = [];
  for (let i = 0; i < count; i += 1) out.push(candle(i * periodMillis(period)));
  return out;
};

/**
 * Collect an async feed into an array so the streamed order can be asserted
 * with one full-payload `toEqual`.
 */
const collect = async (feed: AsyncGenerator<FeedCandle>): Promise<FeedCandle[]> => {
  const out: FeedCandle[] = [];
  for await (const item of feed) out.push(item);
  return out;
};

/** A fresh in-memory candle store seeded with each period's candles. */
const seedRepository = async (
  perPeriod: ReadonlyArray<{ period: Period; candles: Candle[] }>,
): Promise<CandleRepository> => {
  const repository = new InMemoryCandleRepository();
  for (const { period, candles } of perPeriod) await repository.save(SYMBOL, period, candles);
  return repository;
};

/**
 * The eager comparison side: each period's stored `[start, end)` range, ready
 * for `orderBacktestFeed` — exactly what `loadFeed` materializes today.
 */
const rangedPerPeriod = async (
  repository: CandleRepository,
  periods: Period[],
  start: number,
  end: number,
): Promise<Array<{ period: Period; candles: Candle[] }>> =>
  Promise.all(
    periods.map(async (period) => ({
      period,
      candles: await repository.range(SYMBOL, period, start, end),
    })),
  );

/**
 * A deterministic pseudo-random multi-period fixture (seeded LCG): per period,
 * a run of candles at randomized strides so completion times collide across
 * periods and chunk boundaries fall mid-series.
 */
const randomFixture = (seed: number): Array<{ period: Period; candles: Candle[] }> => {
  let state = seed;
  const next = (): number => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
  return [Period.OneMinute, Period.FiveMinutes, Period.OneHour].map((period) => {
    const count = 5 + Math.floor(next() * 60);
    const candles: Candle[] = [];
    let time = Math.floor(next() * 5) * periodMillis(period);
    for (let i = 0; i < count; i += 1) {
      candles.push(candle(time));
      time += periodMillis(period) * (1 + Math.floor(next() * 3));
    }
    return { period, candles };
  });
};

describe('completionKey', () => {
  it('keys a candle by completion time with the period-millis tie-break component', () => {
    expect(completionKey(candle(600_000), Period.FiveMinutes)).toEqual([900_000, 300_000]);
  });
});

describe('lessThan', () => {
  it('orders keys by completion time, then finer period on completion ties, and rejects equal keys', () => {
    expect(lessThan([100, 60_000], [200, 60_000])).toBe(true);
    expect(lessThan([200, 60_000], [100, 60_000])).toBe(false);
    expect(lessThan([200, 60_000], [200, 300_000])).toBe(true);
    expect(lessThan([200, 300_000], [200, 60_000])).toBe(false);
    expect(lessThan([200, 60_000], [200, 60_000])).toBe(false);
  });
});

describe('streamFeed', () => {
  it('emits a multi-period window in exactly the order orderBacktestFeed produces', async () => {
    const periods = [Period.OneMinute, Period.FiveMinutes, Period.OneHour];
    const repository = await seedRepository([
      { period: Period.OneMinute, candles: [candle(0), candle(60_000), candle(120_000)] },
      { period: Period.FiveMinutes, candles: [candle(0), candle(300_000), candle(600_000)] },
      { period: Period.OneHour, candles: [candle(0)] },
    ]);
    const collected = await collect(streamFeed(repository, SYMBOL, periods, 0, 600_000));
    expect(collected).toEqual(
      orderBacktestFeed(await rangedPerPeriod(repository, periods, 0, 600_000)),
    );
  });

  it('breaks completion-time ties finest-period-first regardless of the period argument order', async () => {
    const repository = await seedRepository([
      { period: Period.FiveMinutes, candles: [candle(0)] },
      {
        period: Period.OneMinute,
        candles: [candle(0), candle(60_000), candle(120_000), candle(180_000), candle(240_000)],
      },
    ]);
    const collected = await collect(
      streamFeed(repository, SYMBOL, [Period.FiveMinutes, Period.OneMinute], 0, 300_000),
    );
    expect(collected).toEqual<FeedCandle[]>([
      { period: Period.OneMinute, candle: candle(0) },
      { period: Period.OneMinute, candle: candle(60_000) },
      { period: Period.OneMinute, candle: candle(120_000) },
      { period: Period.OneMinute, candle: candle(180_000) },
      { period: Period.OneMinute, candle: candle(240_000) },
      { period: Period.FiveMinutes, candle: candle(0) },
    ]);
  });

  it('yields nothing when no candles are stored in the window', async () => {
    const repository = new InMemoryCandleRepository();
    const collected = await collect(
      streamFeed(repository, SYMBOL, [Period.OneMinute, Period.OneHour], 0, 3_600_000),
    );
    expect(collected).toEqual([]);
  });

  it('refills across chunk boundaries without losing or reordering candles when the chunk is smaller than a series', async () => {
    const periods = [Period.OneMinute, Period.FiveMinutes];
    const repository = await seedRepository([
      { period: Period.OneMinute, candles: consecutive(Period.OneMinute, 10) },
      { period: Period.FiveMinutes, candles: consecutive(Period.FiveMinutes, 4) },
    ]);
    const collected = await collect(streamFeed(repository, SYMBOL, periods, 0, 1_200_000, 3));
    expect(collected).toEqual(
      orderBacktestFeed(await rangedPerPeriod(repository, periods, 0, 1_200_000)),
    );
  });

  it('matches orderBacktestFeed on a seeded pseudo-random multi-period fixture', async () => {
    const periods = [Period.OneMinute, Period.FiveMinutes, Period.OneHour];
    const repository = await seedRepository(randomFixture(20_260_708));
    const collected = await collect(
      streamFeed(repository, SYMBOL, periods, 0, Number.MAX_SAFE_INTEGER, 7),
    );
    expect(collected).toEqual(
      orderBacktestFeed(await rangedPerPeriod(repository, periods, 0, Number.MAX_SAFE_INTEGER)),
    );
  });
});
