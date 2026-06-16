import { Period } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { parseConfigResolver } from './parse-config-resolver';

/**
 * Pure resolver tests — exercises the `parseConfig` → react-hook-form bridge
 * with no React on top.
 */
describe('parseConfigResolver', () => {
  it('returns the validated Config and empty errors for a valid input', async () => {
    const values = { periods: [Period.OneHour, Period.OneDay], defaultPeriod: Period.OneDay };
    const result = await parseConfigResolver(values, undefined, {
      fields: {},
      shouldUseNativeValidation: false,
    });
    expect(result).toEqual({
      values: { periods: [Period.OneHour, Period.OneDay], defaultPeriod: Period.OneDay },
      errors: {},
    });
  });

  it('returns a periods error carrying the ConfigError message when periods is empty', async () => {
    const values = { periods: [], defaultPeriod: Period.OneDay };
    const result = await parseConfigResolver(values, undefined, {
      fields: {},
      shouldUseNativeValidation: false,
    });
    expect(result).toEqual({
      values: {},
      errors: {
        periods: { type: 'parseConfig', message: 'periods must not be empty' },
      },
    });
  });
});
