import { Period } from '@lametrader/core';
import { validateEnv } from './env.validation.js';

describe('validateEnv', () => {
  it('resolves the full default config when no env vars are set', () => {
    expect(validateEnv({})).toEqual({
      mongoUri: 'mongodb://lametrader:lametrader@localhost:27017/lametrader?authSource=admin',
      redisUrl: 'redis://localhost:6379',
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

  it('reads redisUrl from REDIS_URL when set', () => {
    expect(validateEnv({ REDIS_URL: 'redis://cache:6380/2' }).redisUrl).toEqual(
      'redis://cache:6380/2',
    );
  });

  it('throws a fail-fast error when PORT is not an integer in range', () => {
    expect(() => validateEnv({ PORT: '70000' })).toThrow(
      'PORT must be an integer in 1..65535: 70000',
    );
  });
});
