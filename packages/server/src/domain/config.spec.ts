import { type Config, Period } from '@lametrader/core';
import { defaultConfig, mergeConfig, parseConfig } from './config.js';

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
});

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
