import { Period, periodMillis } from '@lametrader/core';

/**
 * The chart's date-range preset — how much history the user wants visible.
 * Stored in the URL (`?range=…`) as the enum value; rendered in the toolbar
 * label and the period+range dialog. Cooperates with {@link rangeMillis} to
 * determine how far back the candle feed must reach before the chart settles.
 */
export enum ChartRange {
  OneDay = '1d',
  FiveDays = '5d',
  OneMonth = '1m',
  ThreeMonths = '3m',
  SixMonths = '6m',
  YearToDate = 'ytd',
  OneYear = '1y',
  FiveYears = '5y',
  All = 'all',
}

/** The preset order shown in the dialog (shortest → longest). */
export const CHART_RANGE_ORDER: readonly ChartRange[] = [
  ChartRange.OneDay,
  ChartRange.FiveDays,
  ChartRange.OneMonth,
  ChartRange.ThreeMonths,
  ChartRange.SixMonths,
  ChartRange.YearToDate,
  ChartRange.OneYear,
  ChartRange.FiveYears,
  ChartRange.All,
];

/** The visible label for a range button (e.g. `1D`, `YTD`, `All`). */
export function rangeLabel(range: ChartRange): string {
  switch (range) {
    case ChartRange.OneDay:
      return '1D';
    case ChartRange.FiveDays:
      return '5D';
    case ChartRange.OneMonth:
      return '1M';
    case ChartRange.ThreeMonths:
      return '3M';
    case ChartRange.SixMonths:
      return '6M';
    case ChartRange.YearToDate:
      return 'YTD';
    case ChartRange.OneYear:
      return '1Y';
    case ChartRange.FiveYears:
      return '5Y';
    case ChartRange.All:
      return 'All';
  }
}

const DAY_MS = periodMillis(Period.OneDay);

/**
 * The lookback span (epoch-ms duration) for a range preset, anchored at `now`.
 * `All` returns the largest safe value so the chart's visible range stretches
 * to the earliest loaded candle and the feed can keep walking back; `YTD`
 * resolves dynamically from January 1 of the current year.
 */
export function rangeMillis(range: ChartRange, now: number = Date.now()): number {
  switch (range) {
    case ChartRange.OneDay:
      return DAY_MS;
    case ChartRange.FiveDays:
      return 5 * DAY_MS;
    case ChartRange.OneMonth:
      return 30 * DAY_MS;
    case ChartRange.ThreeMonths:
      return 90 * DAY_MS;
    case ChartRange.SixMonths:
      return 180 * DAY_MS;
    case ChartRange.YearToDate:
      return now - Date.UTC(new Date(now).getUTCFullYear(), 0, 1);
    case ChartRange.OneYear:
      return 365 * DAY_MS;
    case ChartRange.FiveYears:
      return 5 * 365 * DAY_MS;
    case ChartRange.All:
      return Number.MAX_SAFE_INTEGER;
  }
}
