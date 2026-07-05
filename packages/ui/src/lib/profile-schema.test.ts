import { describe, expect, it } from 'vitest';
import { type ProfileFormValues, profileFormSchema } from './profile-schema.js';

describe('profileFormSchema', () => {
  it('defaults a missing description to an empty string', () => {
    expect(profileFormSchema.cast({ name: 'Scalper', enabled: true })).toEqual({
      name: 'Scalper',
      description: '',
      enabled: true,
    });
  });

  it('validates and round-trips a provided value untouched', () => {
    const values: ProfileFormValues = {
      name: 'Scalper',
      description: 'fast',
      enabled: true,
    };
    expect(profileFormSchema.validateSync(values)).toEqual(values);
  });
});
