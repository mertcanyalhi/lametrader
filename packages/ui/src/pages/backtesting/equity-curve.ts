import type { BacktestTrade } from '@lametrader/core';

/**
 * One point on the equity curve — the running realized P/L after a trade closes.
 *
 * `time` is the trade's exit epoch ms (the curve's x-axis); `value` is the
 * cumulative net P/L of every closed trade through that exit.
 */
export interface EquityPoint {
  /** Exit epoch ms of the trade this point lands on. */
  time: number;
  /** Cumulative net P/L of every closed trade through this exit. */
  value: number;
}

/**
 * Build the cumulative-P/L equity curve from closed trades, ordered by exit time.
 *
 * Each trade adds its `pnl` to the running total, plotted at its `exitTs`. Trades
 * sharing an exit time collapse to a single point carrying the total through that
 * instant, so the series has strictly ascending, unique times (the shape
 * `lightweight-charts` requires). The open position (no exit) contributes nothing.
 *
 * @param trades - the run's closed trades, in any order.
 */
export function cumulativePnl(trades: readonly BacktestTrade[]): EquityPoint[] {
  const sorted = [...trades].sort((a, b) => a.exitTs - b.exitTs);
  const byTime = new Map<number, number>();
  let sum = 0;
  for (const trade of sorted) {
    sum += trade.pnl;
    byTime.set(trade.exitTs, sum);
  }
  return [...byTime.entries()]
    .map(([time, value]) => ({ time, value }))
    .sort((a, b) => a.time - b.time);
}
