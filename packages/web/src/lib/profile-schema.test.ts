import { describe, expect, it } from 'vitest';
import { type ProfileFormValues, profileFormSchema } from './profile-schema.js';

describe('profileFormSchema chartStates', () => {
  it('defaults a missing chartStates to an empty array', () => {
    expect(profileFormSchema.cast({ name: 'Scalper', description: 'fast', enabled: true })).toEqual(
      {
        name: 'Scalper',
        description: 'fast',
        enabled: true,
        chartStates: [],
      },
    );
  });

  it('validates and round-trips a provided chartStates untouched', () => {
    const values: ProfileFormValues = {
      name: 'Scalper',
      description: 'fast',
      enabled: true,
      chartStates: ['price:trend', 'rsi:zone'],
    };
    expect(profileFormSchema.validateSync(values)).toEqual(values);
  });
});
