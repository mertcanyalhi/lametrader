import { Period } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { finestFinerPeriod } from './periods.js';

describe('finestFinerPeriod', () => {
  it('returns the finest period strictly finer than the target', () => {
    expect(
      finestFinerPeriod([Period.OneMinute, Period.FifteenMinutes, Period.OneHour], Period.OneHour),
    ).toEqual(Period.OneMinute);
  });

  it('returns null when no period is strictly finer than the target', () => {
    expect(finestFinerPeriod([Period.OneHour, Period.OneDay], Period.OneHour)).toEqual(null);
  });

  it('returns null for an empty list', () => {
    expect(finestFinerPeriod([], Period.OneHour)).toEqual(null);
  });
});
