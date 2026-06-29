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
      telegramDestinations: [],
      logLevel: 'info',
      logScopes: [],
    });
  });

  it('reads overrides from the environment', () => {
    expect(loadSettings({ MONGODB_URI: 'mongodb://db:1/x', PORT: '8080' })).toEqual({
      mongoUri: 'mongodb://db:1/x',
      apiPort: 8080,
      pollIntervals: DEFAULT_POLL_INTERVALS,
      telegramDestinations: [],
      logLevel: 'info',
      logScopes: [],
    });
  });

  it('overrides individual poll intervals from POLL_INTERVALS, keeping the rest', () => {
    expect(loadSettings({ POLL_INTERVALS: '{"1m":5000}' })).toEqual({
      mongoUri: 'mongodb://lametrader:lametrader@localhost:27017/lametrader?authSource=admin',
      apiPort: 3000,
      pollIntervals: { ...DEFAULT_POLL_INTERVALS, [Period.OneMinute]: 5000 },
      telegramDestinations: [],
      logLevel: 'info',
      logScopes: [],
    });
  });

  it('throws on a non-numeric PORT instead of yielding NaN', () => {
    expect(() => loadSettings({ PORT: 'not-a-port' })).toThrowError(/PORT/);
  });

  it('throws on a non-positive or non-integer PORT', () => {
    expect(() => loadSettings({ PORT: '0' })).toThrowError(/PORT/);
    expect(() => loadSettings({ PORT: '3000.5' })).toThrowError(/PORT/);
  });

  it('parses TELEGRAM_DESTINATIONS into the typed array', () => {
    const env = {
      TELEGRAM_DESTINATIONS: JSON.stringify([
        { name: 'main', botToken: 't1', chatId: 'c1' },
        { name: 'alerts', botToken: 't2', chatId: 'c2' },
      ]),
    };
    expect(loadSettings(env).telegramDestinations).toEqual([
      { name: 'main', botToken: 't1', chatId: 'c1' },
      { name: 'alerts', botToken: 't2', chatId: 'c2' },
    ]);
  });

  it('rejects TELEGRAM_DESTINATIONS with duplicate names', () => {
    const env = {
      TELEGRAM_DESTINATIONS: JSON.stringify([
        { name: 'main', botToken: 't1', chatId: 'c1' },
        { name: 'main', botToken: 't2', chatId: 'c2' },
      ]),
    };
    expect(() => loadSettings(env)).toThrowError(/duplicate name: main/);
  });

  it('rejects TELEGRAM_DESTINATIONS entries missing required string fields', () => {
    const env = {
      TELEGRAM_DESTINATIONS: JSON.stringify([{ name: 'main', botToken: 't1' }]),
    };
    expect(() => loadSettings(env)).toThrowError(/{ name, botToken, chatId } strings/);
  });

  it('rejects a TELEGRAM_DESTINATIONS value that is not a JSON array', () => {
    expect(() => loadSettings({ TELEGRAM_DESTINATIONS: '{"name":"x"}' })).toThrowError(
      /must be a JSON array/,
    );
  });

  it('accepts a recognized LOG_LEVEL', () => {
    expect(loadSettings({ LOG_LEVEL: 'debug' }).logLevel).toEqual('debug');
  });

  it('rejects an unrecognized LOG_LEVEL', () => {
    expect(() => loadSettings({ LOG_LEVEL: 'verbose' })).toThrowError(/LOG_LEVEL/);
  });

  it('defaults logScopes to [] when LOG_SCOPES is unset', () => {
    expect(loadSettings({}).logScopes).toEqual([]);
  });

  it('parses LOG_SCOPES into ordered { pattern, level } entries', () => {
    expect(loadSettings({ LOG_SCOPES: 'engine.rules.*:trace,engine.api:info' }).logScopes).toEqual([
      { pattern: 'engine.rules.*', level: 'trace' },
      { pattern: 'engine.api', level: 'info' },
    ]);
  });

  it('rejects a LOG_SCOPES entry missing the colon separator', () => {
    expect(() => loadSettings({ LOG_SCOPES: 'engine.rules.trace' })).toThrowError(/LOG_SCOPES/);
  });

  it('rejects a LOG_SCOPES entry with an unrecognized level', () => {
    expect(() => loadSettings({ LOG_SCOPES: 'engine.rules.*:loud' })).toThrowError(/LOG_SCOPES/);
  });
});
