/**
 * The replay-window presets offered in the run form's Period picker sidebar, in
 * menu order (top to bottom), plus {@link BacktestRange.Custom} for a freely
 * picked range.
 *
 * UI-only: the API only ever receives the resolved concrete `from`/`to` epoch-ms
 * bounds, so this never crosses into `core` or the backend.
 */
export enum BacktestRange {
  /** The current calendar day, from its local start to now. */
  TodayOnly = 'today',
  /** The whole previous calendar day. */
  YesterdayOnly = 'yesterday',
  /** The trailing 3 days. */
  ThreeDays = '3d',
  /** The trailing 5 days. */
  FiveDays = '5d',
  /** The trailing 7 days. */
  OneWeek = '1w',
  /** The trailing 14 days. */
  TwoWeeks = '2w',
  /** The trailing 30 days. */
  OneMonth = '1M',
  /** The trailing 90 days — the form default. */
  NinetyDays = '90d',
  /** The trailing 365 days. */
  OneYear = '1y',
  /** A range the user picks freely on the calendars. */
  Custom = 'custom',
}

/** A resolved replay window as inclusive-start / exclusive-end epoch-ms bounds. */
export interface RangeBounds {
  /** Window start, epoch ms. */
  from: number;
  /** Window end, epoch ms. */
  to: number;
}

/** Every preset except {@link BacktestRange.Custom}, which has no fixed span. */
export type PresetRange = Exclude<BacktestRange, BacktestRange.Custom>;

/** The Period picker's sidebar options, in top-to-bottom order, each with its label. */
export const RANGE_OPTIONS: ReadonlyArray<{ value: BacktestRange; label: string }> = [
  { value: BacktestRange.TodayOnly, label: 'Today Only' },
  { value: BacktestRange.YesterdayOnly, label: 'Yesterday Only' },
  { value: BacktestRange.ThreeDays, label: '3 Days' },
  { value: BacktestRange.FiveDays, label: '5 Days' },
  { value: BacktestRange.OneWeek, label: '1 Week' },
  { value: BacktestRange.TwoWeeks, label: '2 Weeks' },
  { value: BacktestRange.OneMonth, label: '1 Month' },
  { value: BacktestRange.NinetyDays, label: '90 Days' },
  { value: BacktestRange.OneYear, label: '1 Year' },
  { value: BacktestRange.Custom, label: 'Custom Range' },
];

/** Milliseconds in one day. */
const MS_PER_DAY = 86_400_000;

/** The trailing span, in milliseconds, of each fixed-length "last N" preset. */
const TRAILING_SPAN_MS: Partial<Record<PresetRange, number>> = {
  [BacktestRange.ThreeDays]: 3 * MS_PER_DAY,
  [BacktestRange.FiveDays]: 5 * MS_PER_DAY,
  [BacktestRange.OneWeek]: 7 * MS_PER_DAY,
  [BacktestRange.TwoWeeks]: 14 * MS_PER_DAY,
  [BacktestRange.OneMonth]: 30 * MS_PER_DAY,
  [BacktestRange.NinetyDays]: 90 * MS_PER_DAY,
  [BacktestRange.OneYear]: 365 * MS_PER_DAY,
};

/** The local-midnight epoch ms of the calendar day containing `ms`. */
function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Resolve a preset to concrete `from`/`to` epoch-ms bounds relative to `now`.
 *
 * The day-scoped presets align to local midnight; the "last N" presets are a
 * trailing window ending at `now`. Resolving against wall-clock `now` (rather
 * than the dataset's latest candle) keeps the picker self-contained — the run
 * the server stores still carries the concrete bounds, so a saved backtest stays
 * reproducible.
 *
 * @param preset - the selected preset (never {@link BacktestRange.Custom}).
 * @param now - the reference epoch-ms the window ends at / is measured from.
 */
export function presetRange(preset: PresetRange, now: number): RangeBounds {
  if (preset === BacktestRange.TodayOnly) return { from: startOfDay(now), to: now };
  if (preset === BacktestRange.YesterdayOnly) {
    const todayStart = startOfDay(now);
    return { from: todayStart - MS_PER_DAY, to: todayStart };
  }
  const span = TRAILING_SPAN_MS[preset] ?? 0;
  return { from: now - span, to: now };
}

/**
 * A local `Date` whose wall-clock fields mirror the **UTC** fields of `ms`.
 *
 * `react-date-range` only speaks local-time `Date`s, but the window bounds are
 * stored and displayed in UTC. Feeding the calendar this shifted `Date` makes it
 * render (and let the user pick) the UTC calendar day, not the browser's local
 * one — so picking July 1 in UTC+3 no longer stores June 30. Pair with
 * {@link pickerDateToUtcMs} on the way back out; the two round-trip to the second.
 */
export function utcMsToPickerDate(ms: number): Date {
  const d = new Date(ms);
  return new Date(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
  );
}

/** Inverse of {@link utcMsToPickerDate}: read a picker `Date`'s local fields as a UTC epoch. */
export function pickerDateToUtcMs(date: Date): number {
  return Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  );
}

/**
 * The end of the UTC day *containing* `ms` (its last whole second, `23:59:59`),
 * capped at `now` — so a window whose end day is today stops at the present instant
 * rather than running to a future end-of-day. Used for a run window's `to` so the
 * range covers the *whole* selected end day, not just its opening midnight.
 *
 * Floors `ms` to its UTC midnight first, so re-applying an already-end-of-day value
 * is idempotent (it doesn't drift forward a day each time the picker reopens).
 */
export function endOfUtcDay(ms: number, now: number): number {
  const d = new Date(ms);
  const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.min(dayStart + MS_PER_DAY - 1000, now);
}
