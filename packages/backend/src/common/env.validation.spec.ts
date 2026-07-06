import { Period } from '@lametrader/core';
import { validateEnv } from './env.validation.js';

describe('validateEnv', () => {
  it('resolves the full default config when no env vars are set', () => {
    expect(validateEnv({})).toEqual({
      mongoUri: 'mongodb://lametrader:lametrader@localhost:27017/lametrader?authSource=admin',
      port: 3000,
      pollIntervals: {
        [Period.OneMinute]: 5_000,
        [Period.FiveMinutes]: 30_000,
        [Period.FifteenMinutes]: 60_000,
        [Period.ThirtyMinutes]: 120_000,
        [Period.OneHour]: 300_000,
        [Period.FourHours]: 900_000,
        [Period.OneDay]: 1_800_000,
        [Period.OneWeek]: 3_600_000,
      },
      logLevel: 'info',
      logScopes: [],
    });
  });

  it('throws a fail-fast error when PORT is not an integer in range', () => {
    expect(() => validateEnv({ PORT: '70000' })).toThrow(
      'PORT must be an integer in 1..65535: 70000',
    );
  });
});
