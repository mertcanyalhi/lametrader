import { Period } from '@lametrader/core';

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
