import { describe, expect, it } from 'vitest';
import { ConfigError, defaultConfig, mergeConfig, parseConfig } from './config';
import { type Config, Period } from './config.types';

describe('defaultConfig', () => {
  it('is [1h, 1d] with default 1d', () => {
    expect(defaultConfig()).toEqual({
      periods: [Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneDay,
    });
  });
});

describe('parseConfig', () => {
  it('accepts a valid input and returns the normalized config', () => {
    expect(parseConfig({ periods: ['1h', '4h', '1d'], defaultPeriod: '4h' })).toEqual({
      periods: [Period.OneHour, Period.FourHours, Period.OneDay],
      defaultPeriod: Period.FourHours,
    });
  });

  it('throws on a period outside the enum', () => {
    expect(() => parseConfig({ periods: ['2h'], defaultPeriod: '2h' })).toThrow(
      'unsupported period: 2h',
    );
  });

  it('throws on an empty periods list', () => {
    expect(() => parseConfig({ periods: [], defaultPeriod: '1d' })).toThrow(
      'periods must not be empty',
    );
  });

  it('throws on duplicate periods', () => {
    expect(() => parseConfig({ periods: ['1h', '1h'], defaultPeriod: '1h' })).toThrow(
      'duplicate period: 1h',
    );
  });

  it('throws when defaultPeriod is not in periods', () => {
    expect(() => parseConfig({ periods: ['1h', '1d'], defaultPeriod: '4h' })).toThrow(
      'defaultPeriod 4h is not in periods',
    );
  });

  it('throws a defaultPeriod-tagged error when defaultPeriod is empty', () => {
    const error = parseError({ periods: ['1h'], defaultPeriod: '' });
    expect({ message: error.message, field: error.field }).toEqual({
      message: 'defaultPeriod must not be empty',
      field: 'defaultPeriod',
    });
  });

  it('tags an empty-periods error with the periods field', () => {
    const error = parseError({ periods: [], defaultPeriod: '1d' });
    expect({ message: error.message, field: error.field }).toEqual({
      message: 'periods must not be empty',
      field: 'periods',
    });
  });

  it('tags a defaultPeriod-not-in-periods error with the defaultPeriod field', () => {
    const error = parseError({ periods: ['1h', '1d'], defaultPeriod: '4h' });
    expect({ message: error.message, field: error.field }).toEqual({
      message: 'defaultPeriod 4h is not in periods',
      field: 'defaultPeriod',
    });
  });
});

/**
 * Run `parseConfig` expecting a {@link ConfigError} and return it (narrowed by
 * `instanceof`, no cast). Fails loudly if it doesn't throw a `ConfigError`.
 */
function parseError(input: unknown): ConfigError {
  try {
    parseConfig(input);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected parseConfig to throw a ConfigError');
}

describe('mergeConfig', () => {
  const current: Config = {
    periods: [Period.OneHour, Period.OneDay],
    defaultPeriod: Period.OneDay,
  };

  it('changes only defaultPeriod', () => {
    expect(mergeConfig(current, { defaultPeriod: '1h' })).toEqual({
      periods: [Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneHour,
    });
  });

  it('changes only periods (revalidated)', () => {
    expect(mergeConfig(current, { periods: ['1h', '4h', '1d'] })).toEqual({
      periods: [Period.OneHour, Period.FourHours, Period.OneDay],
      defaultPeriod: Period.OneDay,
    });
  });

  it('throws when the merge drops the current default out of periods', () => {
    expect(() => mergeConfig(current, { periods: ['1h', '4h'] })).toThrow(
      'defaultPeriod 1d is not in periods',
    );
  });
});
