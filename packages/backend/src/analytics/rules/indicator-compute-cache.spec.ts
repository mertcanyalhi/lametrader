import { type IndicatorComputeResult, Period } from '@lametrader/core';
import { createIndicatorComputeCache } from './indicator-compute-cache.js';
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
