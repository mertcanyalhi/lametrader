import type { Period } from '@lametrader/core';

/**
 * The max resident bar count per period a streamed backtest run must keep —
 * the deepest number of bars any read during a drain can reach behind the bar
 * under evaluation, rounded up to a page multiple plus one page of safety
 * margin (design §2 of `docs/designs/streaming-backtest-feed.md`).
 *
 * Derived from the profile by
 * {@link import('./derive-max-lookback.js').deriveMaxLookback} **before** the
 * run, so Phase 1's sliding window can never be too small at read time.
 */
export type MaxLookbackByPeriod = Map<Period, number>;
