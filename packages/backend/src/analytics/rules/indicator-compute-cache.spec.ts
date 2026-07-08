import { type IndicatorComputeResult, Period } from '@lametrader/core';
import {
  createIndicatorComputeCache,
  createRunScopedIndicatorComputeCache,
} from './indicator-compute-cache.js';
import type { IndicatorComputeKey } from './indicator-compute-cache.types.js';

const KEY: IndicatorComputeKey = {
  symbolId: 'BTC',
  indicatorKey: 'sma',
  inputs: { length: 3, source: 'close' },
  period: Period.OneMinute,
  from: 60_000,
  to: 180_001,
};

const result = (value: number): IndicatorComputeResult => ({
  indicatorKey: 'sma',
  version: 1,
  period: Period.OneMinute,
  state: [{ time: 180_000, value }],
});

describe('createIndicatorComputeCache', () => {
  it('runs the loader once for a repeated identity and returns the memoized result to both callers', async () => {
    const cache = createIndicatorComputeCache();
    const loaded: number[] = [];
    let next = 0;
    const load = (): Promise<IndicatorComputeResult> => {
      next += 1;
      loaded.push(next);
      return Promise.resolve(result(next));
    };

    const first = await cache.compute(KEY, load);
    const second = await cache.compute({ ...KEY }, load);

    expect({ first, second, loaded }).toEqual({
      first: result(1),
      second: result(1),
      loaded: [1],
    });
  });

  it('runs the loader again for a different identity so distinct windows are never conflated', async () => {
    const cache = createIndicatorComputeCache();
    const loaded: number[] = [];
    let next = 0;
    const load = (): Promise<IndicatorComputeResult> => {
      next += 1;
      loaded.push(next);
      return Promise.resolve(result(next));
    };

    const first = await cache.compute(KEY, load);
    const advanced = await cache.compute({ ...KEY, to: 240_001 }, load);

    expect({ first, advanced, loaded }).toEqual({
      first: result(1),
      advanced: result(2),
      loaded: [1, 2],
    });
  });
});

describe('createRunScopedIndicatorComputeCache', () => {
  it('runs the loader once for a repeated identity and returns the memoized result to both callers', async () => {
    const cache = createRunScopedIndicatorComputeCache();
    const loaded: number[] = [];
    let next = 0;
    const load = (): Promise<IndicatorComputeResult> => {
      next += 1;
      loaded.push(next);
      return Promise.resolve(result(next));
    };

    const first = await cache.compute(KEY, load);
    const second = await cache.compute({ ...KEY }, load);

    expect({ first, second, loaded }).toEqual({
      first: result(1),
      second: result(1),
      loaded: [1],
    });
  });

  it('runs the loader again for a different identity so distinct windows are never conflated', async () => {
    const cache = createRunScopedIndicatorComputeCache();
    const loaded: number[] = [];
    let next = 0;
    const load = (): Promise<IndicatorComputeResult> => {
      next += 1;
      loaded.push(next);
      return Promise.resolve(result(next));
    };

    const first = await cache.compute(KEY, load);
    const advanced = await cache.compute({ ...KEY, to: 240_001 }, load);

    expect({ first, advanced, loaded }).toEqual({
      first: result(1),
      advanced: result(2),
      loaded: [1, 2],
    });
  });

  it('evicts the oldest identity beyond maxEntries so the cache stays bounded while the newest still hits', async () => {
    const cache = createRunScopedIndicatorComputeCache(2);
    const loaded: number[] = [];
    let next = 0;
    const load = (): Promise<IndicatorComputeResult> => {
      next += 1;
      loaded.push(next);
      return Promise.resolve(result(next));
    };
    // Three distinct windows overflow the two-entry cap, evicting the oldest.
    await cache.compute(KEY, load);
    await cache.compute({ ...KEY, to: 240_001 }, load);
    await cache.compute({ ...KEY, to: 300_001 }, load);

    const evictedOldest = await cache.compute(KEY, load);
    const retainedNewest = await cache.compute({ ...KEY, to: 300_001 }, load);

    expect({ evictedOldest, retainedNewest, loaded }).toEqual({
      evictedOldest: result(4),
      retainedNewest: result(3),
      loaded: [1, 2, 3, 4],
    });
  });

  it('refreshes recency on a hit so a re-read entry survives eviction while the untouched older one is evicted', async () => {
    const cache = createRunScopedIndicatorComputeCache(2);
    const loaded: number[] = [];
    let next = 0;
    const load = (): Promise<IndicatorComputeResult> => {
      next += 1;
      loaded.push(next);
      return Promise.resolve(result(next));
    };
    // Fill the cap, re-read the first entry (refreshing its recency), then
    // overflow — the untouched second entry is now the eviction victim.
    await cache.compute(KEY, load);
    await cache.compute({ ...KEY, to: 240_001 }, load);
    await cache.compute(KEY, load);
    await cache.compute({ ...KEY, to: 300_001 }, load);

    const refreshedSurvivor = await cache.compute(KEY, load);
    const evictedUntouched = await cache.compute({ ...KEY, to: 240_001 }, load);

    expect({ refreshedSurvivor, evictedUntouched, loaded }).toEqual({
      refreshedSurvivor: result(1),
      evictedUntouched: result(4),
      loaded: [1, 2, 3, 4],
    });
  });

  it('evicts a rejected compute on settlement so the same identity is retried instead of replaying the failure for the run', async () => {
    const cache = createRunScopedIndicatorComputeCache();
    const loaded: number[] = [];
    let next = 0;
    const okLoad = (): Promise<IndicatorComputeResult> => {
      next += 1;
      loaded.push(next);
      return Promise.resolve(result(next));
    };
    await expect(
      cache.compute(KEY, () => Promise.reject(new Error('transient compute failure'))),
    ).rejects.toThrow('transient compute failure');

    const retried = await cache.compute(KEY, okLoad);

    expect({ retried, loaded }).toEqual({ retried: result(1), loaded: [1] });
  });
});
