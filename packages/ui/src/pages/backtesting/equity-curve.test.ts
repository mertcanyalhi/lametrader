import type { BacktestTrade } from '@lametrader/core';
import { BacktestExitReason } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { cumulativePnl } from './equity-curve.js';

/** Build a closed trade exiting at `exitTs` with net P/L `pnl` (other fields unused here). */
function trade(exitTs: number, pnl: number): BacktestTrade {
  return {
    entryTs: exitTs - 1_000,
    exitTs,
    entryPrice: 100,
    exitPrice: 100 + pnl,
    quantity: 1,
    commission: 0,
    pnl,
    roiPct: pnl,
    exitReason: BacktestExitReason.Signal,
  };
}

describe('cumulativePnl', () => {
  it('accumulates each trade P/L at its exit time, ascending', () => {
    expect(cumulativePnl([trade(3_000, 5), trade(1_000, 10), trade(2_000, -4)])).toEqual([
      { time: 1_000, value: 10 },
      { time: 2_000, value: 6 },
      { time: 3_000, value: 11 },
    ]);
  });

  it('collapses trades sharing an exit time to one point carrying the running total', () => {
    expect(cumulativePnl([trade(1_000, 10), trade(1_000, -3)])).toEqual([
      { time: 1_000, value: 7 },
    ]);
  });

  it('returns an empty series when there are no trades', () => {
    expect(cumulativePnl([])).toEqual([]);
  });
});
