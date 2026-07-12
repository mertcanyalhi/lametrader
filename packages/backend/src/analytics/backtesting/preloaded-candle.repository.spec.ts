import { type Candle, type CandleRepository, Period, SymbolType } from '@lametrader/core';
import { InMemoryCandleRepository } from '../../market/persistence/in-memory-candle.repository.js';
import { preloadCandleRepository } from './preloaded-candle.repository.js';

const SYMBOL = 'crypto:BTCUSDT';
const MIN = 60_000;

/** A flat crypto candle at `time`. */
const candle = (time: number): Candle => ({
  type: SymbolType.Crypto,
  time,
  open: 1,
  high: 1,
  low: 1,
  close: 1,
  volume: 1,
  quoteVolume: 1,
  trades: 1,
});

/**
 * A {@link CandleRepository} decorator that counts read calls so a test can
 * assert whether the preloaded repo served from memory (no delegation) or fell
 * through to the store.
 */
class CountingCandleRepository implements CandleRepository {
  rangeCalls = 0;
  latestNCalls = 0;
  latestCalls = 0;
  constructor(private readonly inner: CandleRepository) {}
  async range(symbolId: string, period: Period, from: number, to: number, limit?: number) {
    this.rangeCalls += 1;
    return this.inner.range(symbolId, period, from, to, limit);
  }
  async latestN(symbolId: string, period: Period, n: number, before?: number) {
    this.latestNCalls += 1;
    return this.inner.latestN(symbolId, period, n, before);
  }
  async latest(symbolId: string, period: Period) {
    this.latestCalls += 1;
    return this.inner.latest(symbolId, period);
  }
  save(symbolId: string, period: Period, candles: Candle[]) {
    return this.inner.save(symbolId, period, candles);
  }
  deleteSymbol(symbolId: string) {
    return this.inner.deleteSymbol(symbolId);
  }
}

/** An inner store holding 1m candles at −3m…+2m plus one beyond `end` (+3m). */
async function seededInner(): Promise<InMemoryCandleRepository> {
  const inner = new InMemoryCandleRepository();
  await inner.save(SYMBOL, Period.OneMinute, [
    candle(-3 * MIN),
    candle(-2 * MIN),
    candle(-1 * MIN),
    candle(0),
    candle(1 * MIN),
    candle(2 * MIN),
    candle(3 * MIN),
  ]);
  return inner;
}

describe('PreloadedCandleRepository', () => {
  it('serves an in-window latestN from memory without touching the inner store', async () => {
    const counting = new CountingCandleRepository(await seededInner());
    // bars=2 → floor = 0 − 2·1m = −2m; window [−2m, 3m) resident.
    const repo = await preloadCandleRepository(counting, SYMBOL, [Period.OneMinute], 2, 0, 3 * MIN);
    counting.latestNCalls = 0;

    const result = await repo.latestN(SYMBOL, Period.OneMinute, 3, 1 * MIN + 1);

    expect({ times: result.map((c) => c.time), delegated: counting.latestNCalls }).toEqual({
      times: [1 * MIN, 0, -1 * MIN],
      delegated: 0,
    });
  });

  it('serves an in-window range from memory without touching the inner store', async () => {
    const counting = new CountingCandleRepository(await seededInner());
    const repo = await preloadCandleRepository(counting, SYMBOL, [Period.OneMinute], 2, 0, 3 * MIN);
    counting.rangeCalls = 0;

    const result = await repo.range(SYMBOL, Period.OneMinute, 0, 3 * MIN);

    expect({ times: result.map((c) => c.time), delegated: counting.rangeCalls }).toEqual({
      times: [0, 1 * MIN, 2 * MIN],
      delegated: 0,
    });
  });

  it('falls through to the inner store for a latestN reaching below the preloaded floor', async () => {
    const counting = new CountingCandleRepository(await seededInner());
    const repo = await preloadCandleRepository(counting, SYMBOL, [Period.OneMinute], 2, 0, 3 * MIN);
    counting.latestNCalls = 0;

    // Wants 5 back from before=1m+1; only 4 are resident (−2m…1m), so the −3m
    // below the floor must come from the inner store.
    const result = await repo.latestN(SYMBOL, Period.OneMinute, 5, 1 * MIN + 1);

    expect({ times: result.map((c) => c.time), delegated: counting.latestNCalls }).toEqual({
      times: [1 * MIN, 0, -1 * MIN, -2 * MIN, -3 * MIN],
      delegated: 1,
    });
  });

  it('falls through to the inner store for a range starting below the preloaded floor', async () => {
    const counting = new CountingCandleRepository(await seededInner());
    const repo = await preloadCandleRepository(counting, SYMBOL, [Period.OneMinute], 2, 0, 3 * MIN);
    counting.rangeCalls = 0;

    const result = await repo.range(SYMBOL, Period.OneMinute, -3 * MIN, 1 * MIN);

    expect({ times: result.map((c) => c.time), delegated: counting.rangeCalls }).toEqual({
      times: [-3 * MIN, -2 * MIN, -1 * MIN, 0],
      delegated: 1,
    });
  });

  it('serves a short latestN from memory when the window bottoms out at true history start', async () => {
    const counting = new CountingCandleRepository(await seededInner());
    // bars=10 → floor = 0 − 10·1m = −10m, below the oldest candle (−3m), so the
    // window holds all history and a short read is complete without the store.
    const repo = await preloadCandleRepository(
      counting,
      SYMBOL,
      [Period.OneMinute],
      10,
      0,
      3 * MIN,
    );
    counting.latestNCalls = 0;

    const result = await repo.latestN(SYMBOL, Period.OneMinute, 100, 1 * MIN + 1);

    expect({ times: result.map((c) => c.time), delegated: counting.latestNCalls }).toEqual({
      times: [1 * MIN, 0, -1 * MIN, -2 * MIN, -3 * MIN],
      delegated: 0,
    });
  });

  it('delegates every read for a series that was not preloaded', async () => {
    const inner = await seededInner();
    await inner.save(SYMBOL, Period.OneHour, [candle(0)]);
    const counting = new CountingCandleRepository(inner);
    const repo = await preloadCandleRepository(counting, SYMBOL, [Period.OneMinute], 2, 0, 3 * MIN);
    counting.latestNCalls = 0;

    const result = await repo.latestN(SYMBOL, Period.OneHour, 1);

    expect({ times: result.map((c) => c.time), delegated: counting.latestNCalls }).toEqual({
      times: [0],
      delegated: 1,
    });
  });

  it('delegates latest to the inner store so it sees candles beyond the loaded window', async () => {
    const counting = new CountingCandleRepository(await seededInner());
    const repo = await preloadCandleRepository(counting, SYMBOL, [Period.OneMinute], 2, 0, 3 * MIN);

    const result = await repo.latest(SYMBOL, Period.OneMinute);

    // The +3m candle is at/after `end`, so it is not resident; latest must still find it.
    expect(result?.time).toEqual(3 * MIN);
  });
});
