import { describe, expect, it } from 'vitest';
import {
  mergeProfileFields,
  ProfileError,
  parseProfileFields,
  parseProfileScope,
} from './profile.js';
import { type ProfileFields, ProfileScope } from './profile.types.js';

describe('parseProfileScope', () => {
  it('returns an explicit symbols scope unchanged', () => {
    expect(parseProfileScope({ type: 'symbols', symbolIds: ['crypto:BTCUSDT'] })).toEqual({
      type: ProfileScope.Symbols,
      symbolIds: ['crypto:BTCUSDT'],
    });
  });

  it('normalizes an empty symbols subset to the all scope', () => {
    expect(parseProfileScope({ type: 'symbols', symbolIds: [] })).toEqual({
      type: ProfileScope.All,
    });
  });

  it('returns the all scope', () => {
    expect(parseProfileScope({ type: 'all' })).toEqual({ type: ProfileScope.All });
  });

  it('throws on an unknown scope type or a non-string id', () => {
    expect(() => parseProfileScope({ type: 'nope' })).toThrow(ProfileError);
    expect(() => parseProfileScope({ type: 'symbols', symbolIds: [42] })).toThrow(ProfileError);
  });
});

describe('parseProfileFields', () => {
  it('applies defaults and validates the name', () => {
    expect(parseProfileFields({ name: 'Scalper' })).toEqual({
      name: 'Scalper',
      description: '',
      enabled: true,
      scope: { type: ProfileScope.All },
    });
    expect(() => parseProfileFields({ name: '   ' })).toThrow(ProfileError);
  });
});

describe('mergeProfileFields', () => {
  it('overlays a patch and revalidates, keeping omitted fields', () => {
    const current: ProfileFields = {
      name: 'Scalper',
      description: 'fast',
      enabled: true,
      scope: { type: ProfileScope.All },
    };
    expect(mergeProfileFields(current, { enabled: false })).toEqual({
      name: 'Scalper',
      description: 'fast',
      enabled: false,
      scope: { type: ProfileScope.All },
    });
  });
});
