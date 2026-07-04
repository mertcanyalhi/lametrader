import { ExpirationError, validateExpiration } from './expiration.js';

const NOW = 1_700_000_000_000;

describe('validateExpiration', () => {
  it('accepts a null expiration (never expires)', () => {
    expect(() => validateExpiration(null, NOW)).not.toThrow();
  });

  it('accepts an expiration strictly in the future', () => {
    expect(() => validateExpiration({ at: NOW + 1 }, NOW)).not.toThrow();
  });

  it('rejects an expiration equal to now', () => {
    expect(() => validateExpiration({ at: NOW }, NOW)).toThrow(ExpirationError);
  });

  it('rejects an expiration in the past', () => {
    expect(() => validateExpiration({ at: NOW - 1 }, NOW)).toThrow(ExpirationError);
  });

  it('rejects a non-finite expiration', () => {
    expect(() => validateExpiration({ at: Number.POSITIVE_INFINITY }, NOW)).toThrow(
      ExpirationError,
    );
  });
});
