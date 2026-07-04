import { describe, expect, it } from 'vitest';
import { Period } from './config.types.js';
import { periodMillis } from './period.js';

describe('periodMillis', () => {
  it('returns the fixed duration of each period in milliseconds', () => {
    expect(periodMillis(Period.OneMinute)).toBe(60_000);
    expect(periodMillis(Period.OneDay)).toBe(86_400_000);
    expect(periodMillis(Period.OneWeek)).toBe(604_800_000);
  });
});
