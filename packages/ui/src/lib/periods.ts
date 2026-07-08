import { Period, periodMillis } from '@lametrader/core';

/**
 * The canonical render order for periods — mirrors `Period`'s declared order,
 * smallest timeframe first. Used to keep timeframe bars and serialized period
 * arrays in a stable, human-expected order regardless of selection order.
 */
export const PERIOD_ORDER: readonly Period[] = [
  Period.OneMinute,
  Period.FiveMinutes,
  Period.FifteenMinutes,
  Period.ThirtyMinutes,
  Period.OneHour,
  Period.FourHours,
  Period.OneDay,
  Period.OneWeek,
];

/**
 * Return the given periods sorted into {@link PERIOD_ORDER}. A new array; the
 * input is not mutated. Unknown values (shouldn't occur) sort to the end.
 */
export function sortPeriods(periods: readonly Period[]): Period[] {
  return [...periods].sort((a, b) => PERIOD_ORDER.indexOf(a) - PERIOD_ORDER.indexOf(b));
}

/**
 * The finest (shortest-duration) period in `periods` strictly finer than
 * `target`, or `null` when none is finer.
 *
 * Picks which streamed period to fold up into a coarser charted period's forming
 * bar: charting `OneHour` while `OneMinute` and `FifteenMinutes` also stream
 * returns `OneMinute`. When `target` is itself the finest available (the common
 * case), the result is `null` and no folding engages — the charted period renders
 * its own candles unchanged.
 *
 * @param periods - the candidate periods (e.g. a symbol's watched periods).
 * @param target - the charted period.
 */
export function finestFinerPeriod(periods: readonly Period[], target: Period): Period | null {
  const targetMs = periodMillis(target);
  let best: Period | null = null;
  let bestMs = Number.POSITIVE_INFINITY;
  for (const period of periods) {
    const ms = periodMillis(period);
    if (ms < targetMs && ms < bestMs) {
      best = period;
      bestMs = ms;
    }
  }
  return best;
}
