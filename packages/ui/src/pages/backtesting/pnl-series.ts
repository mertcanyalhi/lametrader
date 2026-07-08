import type { BacktestTrade } from '@lametrader/core';

/**
 * One point on a P/L baseline series — a realized-P/L value at a trade's exit.
 *
 * `time` is the trade's exit epoch ms (the series' x-axis); `value` is a P/L
 * figure at that instant — the running total for the equity curve, or the trade's
 * own net P/L for the per-trade win/lose series.
 */
export interface PnlPoint {
  /** Exit epoch ms of the trade this point lands on. */
  time: number;
  /** A realized-P/L value at this exit (cumulative or per-trade, per builder). */
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
export function cumulativePnl(trades: readonly BacktestTrade[]): PnlPoint[] {
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

/**
 * Build the per-trade win/lose series from closed trades, ordered by exit time.
 *
 * Each point is a trade's **own** net P/L (not a running total), plotted at its
 * `exitTs` — a win sits above the zero baseline, a loss below. Trades sharing an
 * exit time sum into one point (that instant's net), keeping times strictly
 * ascending and unique. The open position (no exit) contributes nothing.
 *
 * @param trades - the run's closed trades, in any order.
 */
export function perTradePnl(trades: readonly BacktestTrade[]): PnlPoint[] {
  const byTime = new Map<number, number>();
  for (const trade of trades) {
    byTime.set(trade.exitTs, (byTime.get(trade.exitTs) ?? 0) + trade.pnl);
  }
  return [...byTime.entries()]
    .map(([time, value]) => ({ time, value }))
    .sort((a, b) => a.time - b.time);
}
