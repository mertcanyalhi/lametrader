import { Period } from './types/config/config.types.js';

/**
 * The fixed duration of each {@link Period}, in milliseconds. Lets callers
 * decide whether a candle's bar has closed (`time + periodMillis(period) <= now`).
 */
const PERIOD_MILLIS: Record<Period, number> = {
  [Period.OneMinute]: 60_000,
  [Period.FiveMinutes]: 300_000,
  [Period.FifteenMinutes]: 900_000,
  [Period.ThirtyMinutes]: 1_800_000,
  [Period.OneHour]: 3_600_000,
  [Period.FourHours]: 14_400_000,
  [Period.OneDay]: 86_400_000,
  [Period.OneWeek]: 604_800_000,
};

/**
 * The fixed duration of a {@link Period} in milliseconds.
 *
 * @param period - the period to measure.
 */
export function periodMillis(period: Period): number {
  return PERIOD_MILLIS[period];
}
