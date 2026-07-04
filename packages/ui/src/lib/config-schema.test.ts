import { yupResolver } from '@hookform/resolvers/yup';
import { type Config, Period } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { configSchema } from './config-schema';

/**
 * Tests for the settings form's Yup schema, exercised through `yupResolver`
 * exactly as the form uses it. Each case asserts the per-field messages
 * react-hook-form would surface.
 */
describe('config schema resolver', () => {
  const resolve = yupResolver(configSchema);
  const options = { fields: {}, shouldUseNativeValidation: false } as const;

  /**
   * Run the resolver and return the message react-hook-form would attach to
   * each field (or `undefined` when the field is valid).
   */
  async function fieldMessages(values: Config): Promise<{
    periods?: string;
    defaultPeriod?: string;
  }> {
    const result = await resolve(values, undefined, options);
    return {
      periods: result.errors.periods?.message,
      defaultPeriod: result.errors.defaultPeriod?.message,
    };
  }

  it('accepts a valid config', async () => {
    const result = await resolve(
      { periods: [Period.OneHour, Period.OneDay], defaultPeriod: Period.OneDay },
      undefined,
      options,
    );
    expect(result).toEqual({
      values: { periods: [Period.OneHour, Period.OneDay], defaultPeriod: Period.OneDay },
      errors: {},
    });
  });

  it('flags an empty periods selection on the periods field', async () => {
    expect(await fieldMessages({ periods: [], defaultPeriod: Period.OneDay })).toEqual({
      periods: 'Select at least one period.',
      defaultPeriod: 'Default period must be one of the selected periods.',
    });
  });

  it('flags an empty default period on the defaultPeriod field', async () => {
    expect(await fieldMessages({ periods: [Period.OneHour], defaultPeriod: '' as Period })).toEqual(
      {
        periods: undefined,
        defaultPeriod: 'Default period is required.',
      },
    );
  });

  it('flags a default period that is not among the selected periods', async () => {
    expect(
      await fieldMessages({ periods: [Period.OneHour], defaultPeriod: Period.OneDay }),
    ).toEqual({
      periods: undefined,
      defaultPeriod: 'Default period must be one of the selected periods.',
    });
  });
});
