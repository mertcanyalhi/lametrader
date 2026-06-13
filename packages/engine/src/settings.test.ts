import { describe, expect, it } from 'vitest';
import { loadSettings } from './settings';

describe('loadSettings', () => {
  it('falls back to defaults when the environment is empty', () => {
    expect(loadSettings({})).toEqual({
      mongoUri: 'mongodb://lametrader:lametrader@localhost:27017/lametrader?authSource=admin',
      apiPort: 3000,
    });
  });

  it('reads overrides from the environment', () => {
    expect(loadSettings({ MONGODB_URI: 'mongodb://db:1/x', PORT: '8080' })).toEqual({
      mongoUri: 'mongodb://db:1/x',
      apiPort: 8080,
    });
  });

  it('throws on a non-numeric PORT instead of yielding NaN', () => {
    expect(() => loadSettings({ PORT: 'not-a-port' })).toThrowError(/PORT/);
  });

  it('throws on a non-positive or non-integer PORT', () => {
    expect(() => loadSettings({ PORT: '0' })).toThrowError(/PORT/);
    expect(() => loadSettings({ PORT: '3000.5' })).toThrowError(/PORT/);
  });
});
