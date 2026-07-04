// @vitest-environment jsdom
import { Period } from '@lametrader/core';
import { afterEach, describe, expect, it } from 'vitest';
import { getStoredPeriod, setStoredPeriod } from './chart-period.js';

describe('chart period persistence', () => {
  afterEach(() => window.localStorage.clear());

  it('round-trips a stored period through localStorage', () => {
    setStoredPeriod(Period.FourHours);

    expect(getStoredPeriod()).toEqual(Period.FourHours);
  });

  it('returns null when no period has been stored', () => {
    expect(getStoredPeriod()).toEqual(null);
  });

  it('returns null for a stored value that is not a known period', () => {
    window.localStorage.setItem('chart-period', 'not-a-period');

    expect(getStoredPeriod()).toEqual(null);
  });
});
