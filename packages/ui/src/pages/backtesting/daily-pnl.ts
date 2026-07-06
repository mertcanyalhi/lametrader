import type { BacktestTrade } from '@lametrader/core';

/** Milliseconds in one UTC day — the bucket width for the daily P&L histogram. */
const MS_PER_DAY = 86_400_000;

/**
 * One day's realized P&L bucket for the Daily P&L histogram.
 *
 * `day` is the UTC-midnight epoch-ms start of the exit day the trades in this
 * bucket closed on; `pnl` is the sum of those trades' whole net P&L.
 */
export interface DailyPnlBar {
  /** UTC-midnight epoch ms of the exit day. */
  day: number;
  /** Σ of the net P&L of every closed trade that exited on this day. */
  pnl: number;
}

/**
 * Bucket closed trades' whole net P&L onto their **exit day** in UTC.
 *
 * Each trade contributes its entire `pnl` to the day its `exitTs` falls on
 * (UTC-midnight boundaries); trades sharing an exit day sum into one bar. The
 * result is ascending by day, with only days that saw at least one exit — the
 * open position (no exit) contributes nothing.
 *
 * @param trades - the run's closed trades, in any order.
 */
export function bucketDailyPnl(trades: readonly BacktestTrade[]): DailyPnlBar[] {
  const byDay = new Map<number, number>();
  for (const trade of trades) {
    const day = utcDayStart(trade.exitTs);
    byDay.set(day, (byDay.get(day) ?? 0) + trade.pnl);
  }
  return [...byDay.entries()].map(([day, pnl]) => ({ day, pnl })).sort((a, b) => a.day - b.day);
}

/**
 * The UTC-midnight epoch ms of the day an epoch-ms instant falls on.
 *
 * The Unix epoch is itself UTC midnight, so flooring to a whole number of days
 * and re-scaling lands exactly on the day's UTC-midnight boundary.
 */
function utcDayStart(ms: number): number {
  return Math.floor(ms / MS_PER_DAY) * MS_PER_DAY;
}
