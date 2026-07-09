import { type Candle, type CandleRepository, Period, SymbolType } from '@lametrader/core';
import { InMemoryCandleRepository } from '../../market/persistence/in-memory-candle.repository.js';
import { ReplayCandleCache } from './replay-candle-cache.js';

/**
 * An {@link InMemoryCandleRepository} that counts `latestN` calls so a test can
 * assert a read was served from the cached window (no delegated call) rather than
 * the store.
 */
class CountingCandleRepository extends InMemoryCandleRepository {
  /** How many times `latestN` reached the store. */
  latestNCalls = 0;

  override latestN(
    symbolId: string,
    period: Period,
    n: number,
    before?: number,
  ): Promise<Candle[]> {
    this.latestNCalls += 1;
    return super.latestN(symbolId, period, n, before);
  }
}

/** Build a minimal FX candle at `time` with a distinguishing `close`. */
function candle(time: number): Candle {
  return { type: SymbolType.Fx, time, open: 1, high: 1, low: 1, close: time };
}

describe('ReplayCandleCache', () => {
  it('serves a repeated same-before latestN read from the cached window without a second store call', async () => {
    const store = new CountingCandleRepository();
    await store.save('BTCUSDT', Period.OneMinute, [candle(100), candle(200), candle(300)]);
    const cache = new ReplayCandleCache(store);

    await cache.latestN('BTCUSDT', Period.OneMinute, 2, 300);
    const second = await cache.latestN('BTCUSDT', Period.OneMinute, 2, 300);

    expect(store.latestNCalls).toBe(1);
    expect(second).toEqual([candle(200), candle(100)]);
  });

  it('serves a forward read within the prefetched window from cache without a second store call', async () => {
    const store = new CountingCandleRepository();
    await store.save('BTCUSDT', Period.OneMinute, [candle(100), candle(200), candle(300)]);
    const cache = new ReplayCandleCache(store);

    await cache.latestN('BTCUSDT', Period.OneMinute, 2, 200);
    const forward = await cache.latestN('BTCUSDT', Period.OneMinute, 2, 250);

    expect(store.latestNCalls).toBe(1);
    expect(forward).toEqual([candle(200), candle(100)]);
  });

  it('never returns a candle at or after the requested before though the window cached it', async () => {
    const store = new InMemoryCandleRepository();
    await store.save('BTCUSDT', Period.OneMinute, [candle(100), candle(200), candle(300)]);
    const cache = new ReplayCandleCache(store);

    const gated = await cache.latestN('BTCUSDT', Period.OneMinute, 1, 250);

    expect(gated).toEqual([candle(200)]);
  });

  it('refetches when the requested before is beyond the cached window bound', async () => {
    const store = new CountingCandleRepository();
    await store.save('BTCUSDT', Period.OneMinute, [candle(100), candle(200), candle(300)]);
    const cache = new ReplayCandleCache(store);

    await cache.latestN('BTCUSDT', Period.OneMinute, 2, 150);
    const beyond = await cache.latestN('BTCUSDT', Period.OneMinute, 2, 100_000_000);

    expect(store.latestNCalls).toBe(2);
    expect(beyond).toEqual([candle(300), candle(200)]);
  });

  it('serves a repeat from cache when the fetch exhausted history shorter than n', async () => {
    const store = new CountingCandleRepository();
    await store.save('BTCUSDT', Period.OneMinute, [candle(100), candle(200)]);
    const cache = new ReplayCandleCache(store);

    await cache.latestN('BTCUSDT', Period.OneMinute, 5, 250);
    const repeat = await cache.latestN('BTCUSDT', Period.OneMinute, 5, 250);

    expect(store.latestNCalls).toBe(1);
    expect(repeat).toEqual([candle(200), candle(100)]);
  });

  it('returns exactly what the wrapped store returns for the same read', async () => {
    const store = new InMemoryCandleRepository();
    await store.save('BTCUSDT', Period.OneMinute, [candle(100), candle(200), candle(300)]);
    const cache = new ReplayCandleCache(store);

    const direct = await store.latestN('BTCUSDT', Period.OneMinute, 2, 250);
    const cached = await cache.latestN('BTCUSDT', Period.OneMinute, 2, 250);

    expect(cached).toEqual(direct);
  });

  it('delegates range straight through to the wrapped store', async () => {
    const store: CandleRepository = new InMemoryCandleRepository();
    await store.save('BTCUSDT', Period.OneMinute, [candle(100), candle(200), candle(300)]);
    const cache = new ReplayCandleCache(store);

    const ranged = await cache.range('BTCUSDT', Period.OneMinute, 150, 350);

    expect(ranged).toEqual([candle(200), candle(300)]);
  });
});
