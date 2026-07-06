import { BacktestExitReason, type BacktestTrade } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { bucketDailyPnl } from './daily-pnl.js';

/** A closed trade exiting at `exitTs` with net `pnl` — the fields bucketing reads. */
function trade(exitTs: number, pnl: number): BacktestTrade {
  return {
    entryTs: 0,
    exitTs,
    entryPrice: 100,
    exitPrice: 110,
    quantity: 1,
    commission: 0,
    pnl,
    roiPct: 0,
    exitReason: BacktestExitReason.Signal,
  };
}

/** `2021-01-01T00:00:00Z` — a clean UTC-midnight anchor for exit-day math. */
const DAY_0 = Date.UTC(2021, 0, 1);
/** `2021-01-02T00:00:00Z` — the next UTC day. */
const DAY_1 = Date.UTC(2021, 0, 2);

describe('bucketDailyPnl', () => {
  it('sums two trades exiting on the same UTC day into one bar', () => {
    const bars = bucketDailyPnl([trade(DAY_0 + 3_600_000, 50), trade(DAY_0 + 80_000_000, -20)]);

    expect(bars).toEqual([{ day: DAY_0, pnl: 30 }]);
  });

  it('buckets trades on different UTC days into separate bars, ascending by day', () => {
    const bars = bucketDailyPnl([trade(DAY_1 + 1_000, 5), trade(DAY_0 + 1_000, 12)]);

    expect(bars).toEqual([
      { day: DAY_0, pnl: 12 },
      { day: DAY_1, pnl: 5 },
    ]);
  });

  it('returns no bars when there are no closed trades', () => {
    expect(bucketDailyPnl([])).toEqual([]);
  });
});
