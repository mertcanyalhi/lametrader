import { describe, expect, it } from 'vitest';
import {
  BacktestRange,
  pickerDateToUtcMs,
  presetRange,
  RANGE_OPTIONS,
  utcMsToPickerDate,
} from './backtest-range.js';

/** Milliseconds in one day. */
const MS_PER_DAY = 86_400_000;

/** A fixed reference instant mid-day so day-alignment is observable. */
const NOW = Date.UTC(2024, 5, 15, 9, 30);

/** The local-midnight epoch of `NOW`, mirroring the module's day alignment. */
function localMidnight(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

describe('RANGE_OPTIONS', () => {
  it('lists the ten presets in sidebar order with their labels', () => {
    expect(RANGE_OPTIONS).toEqual([
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
    ]);
  });
});

describe('presetRange', () => {
  it('resolves Today Only to local midnight through now', () => {
    expect(presetRange(BacktestRange.TodayOnly, NOW)).toEqual({
      from: localMidnight(NOW),
      to: NOW,
    });
  });

  it('resolves Yesterday Only to the whole previous calendar day', () => {
    expect(presetRange(BacktestRange.YesterdayOnly, NOW)).toEqual({
      from: localMidnight(NOW) - MS_PER_DAY,
      to: localMidnight(NOW),
    });
  });

  it('resolves 3 Days to a trailing 3-day window ending at now', () => {
    expect(presetRange(BacktestRange.ThreeDays, NOW)).toEqual({
      from: NOW - 3 * MS_PER_DAY,
      to: NOW,
    });
  });

  it('resolves 5 Days to a trailing 5-day window ending at now', () => {
    expect(presetRange(BacktestRange.FiveDays, NOW)).toEqual({
      from: NOW - 5 * MS_PER_DAY,
      to: NOW,
    });
  });

  it('resolves 1 Week to a trailing 7-day window ending at now', () => {
    expect(presetRange(BacktestRange.OneWeek, NOW)).toEqual({
      from: NOW - 7 * MS_PER_DAY,
      to: NOW,
    });
  });

  it('resolves 2 Weeks to a trailing 14-day window ending at now', () => {
    expect(presetRange(BacktestRange.TwoWeeks, NOW)).toEqual({
      from: NOW - 14 * MS_PER_DAY,
      to: NOW,
    });
  });

  it('resolves 1 Month to a trailing 30-day window ending at now', () => {
    expect(presetRange(BacktestRange.OneMonth, NOW)).toEqual({
      from: NOW - 30 * MS_PER_DAY,
      to: NOW,
    });
  });

  it('resolves 90 Days to a trailing 90-day window ending at now', () => {
    expect(presetRange(BacktestRange.NinetyDays, NOW)).toEqual({
      from: NOW - 90 * MS_PER_DAY,
      to: NOW,
    });
  });

  it('resolves 1 Year to a trailing 365-day window ending at now', () => {
    expect(presetRange(BacktestRange.OneYear, NOW)).toEqual({
      from: NOW - 365 * MS_PER_DAY,
      to: NOW,
    });
  });
});

describe('UTC ↔ picker-date conversion', () => {
  it('mirrors a UTC epoch as the picker Date local calendar day (timezone-independent)', () => {
    const date = utcMsToPickerDate(Date.UTC(2024, 6, 1, 13, 45, 30));
    expect({
      year: date.getFullYear(),
      month: date.getMonth(),
      day: date.getDate(),
      hours: date.getHours(),
      minutes: date.getMinutes(),
      seconds: date.getSeconds(),
    }).toEqual({ year: 2024, month: 6, day: 1, hours: 13, minutes: 45, seconds: 30 });
  });

  it('round-trips a UTC epoch through the picker Date and back to the second', () => {
    const ms = Date.UTC(2024, 6, 1, 13, 45, 30);
    expect(pickerDateToUtcMs(utcMsToPickerDate(ms))).toEqual(ms);
  });
});
