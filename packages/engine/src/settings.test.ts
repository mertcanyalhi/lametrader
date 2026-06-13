import { Period } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { loadSettings } from './settings';

/** The default per-period poll intervals (faster ladder, ms). */
const DEFAULT_POLL_INTERVALS = {
  [Period.OneMinute]: 5_000,
  [Period.FiveMinutes]: 30_000,
  [Period.FifteenMinutes]: 60_000,
  [Period.ThirtyMinutes]: 120_000,
  [Period.OneHour]: 300_000,
  [Period.FourHours]: 900_000,
  [Period.OneDay]: 1_800_000,
  [Period.OneWeek]: 3_600_000,
};

describe('loadSettings', () => {
  it('falls back to defaults when the environment is empty', () => {
    expect(loadSettings({})).toEqual({
      mongoUri: 'mongodb://lametrader:lametrader@localhost:27017/lametrader?authSource=admin',
      apiPort: 3000,
      pollIntervals: DEFAULT_POLL_INTERVALS,
    });
  });

  it('reads overrides from the environment', () => {
    expect(loadSettings({ MONGODB_URI: 'mongodb://db:1/x', PORT: '8080' })).toEqual({
      mongoUri: 'mongodb://db:1/x',
      apiPort: 8080,
      pollIntervals: DEFAULT_POLL_INTERVALS,
    });
  });

  it('overrides individual poll intervals from POLL_INTERVALS, keeping the rest', () => {
    expect(loadSettings({ POLL_INTERVALS: '{"1m":5000}' })).toEqual({
      mongoUri: 'mongodb://lametrader:lametrader@localhost:27017/lametrader?authSource=admin',
      apiPort: 3000,
      pollIntervals: { ...DEFAULT_POLL_INTERVALS, [Period.OneMinute]: 5000 },
    });
  });
});
