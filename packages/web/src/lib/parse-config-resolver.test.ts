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

  it('maps an empty-periods ConfigError onto the periods field', async () => {
    const values = { periods: [], defaultPeriod: Period.OneDay };
    const result = await parseConfigResolver(values, undefined, {
      fields: {},
      shouldUseNativeValidation: false,
    });
    expect(result).toEqual({
      values: {},
      errors: {
        periods: { type: 'parseConfig', message: 'Periods must not be empty' },
      },
    });
  });

  it('maps an empty-defaultPeriod ConfigError onto the defaultPeriod field with the human label', async () => {
    const values = { periods: [Period.OneHour], defaultPeriod: '' as Period };
    const result = await parseConfigResolver(values, undefined, {
      fields: {},
      shouldUseNativeValidation: false,
    });
    expect(result).toEqual({
      values: {},
      errors: {
        defaultPeriod: { type: 'parseConfig', message: 'Default period must not be empty' },
      },
    });
  });
});
