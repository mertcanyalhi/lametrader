import { describe, expect, it } from 'vitest';
import { profileSchema } from './profile-schema.js';

/**
 * Tests for the profile form's Yup schema — the user-facing validation layer
 * (the server re-validates via `@lametrader/core`, the authority).
 */
describe('profileSchema', () => {
  it('rejects an empty name with a label-aware required message', async () => {
    await expect(
      profileSchema.validate({ name: '', description: '', enabled: true }),
    ).rejects.toThrow('Name is required.');
  });

  it('accepts a valid name / description / enabled input', async () => {
    await expect(
      profileSchema.validate({ name: 'Scalping', description: 'fast', enabled: false }),
    ).resolves.toEqual({ name: 'Scalping', description: 'fast', enabled: false });
  });
});
