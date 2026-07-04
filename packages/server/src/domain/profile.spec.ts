import { type ProfileFields, ProfileScope } from '@lametrader/core';
import {
  mergeProfileFields,
  ProfileError,
  parseProfileFields,
  parseProfileScope,
} from './profile.js';

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
      chartStates: [],
    });
    expect(() => parseProfileFields({ name: '   ' })).toThrow(ProfileError);
  });

  it('defaults a missing chartStates to an empty array', () => {
    expect(parseProfileFields({ name: 'Scalper' })).toEqual({
      name: 'Scalper',
      description: '',
      enabled: true,
      scope: { type: ProfileScope.All },
      chartStates: [],
    });
  });

  it('accepts a provided chartStates string array unchanged', () => {
    expect(
      parseProfileFields({ name: 'Scalper', chartStates: ['price:trend', 'rsi:zone'] }),
    ).toEqual({
      name: 'Scalper',
      description: '',
      enabled: true,
      scope: { type: ProfileScope.All },
      chartStates: ['price:trend', 'rsi:zone'],
    });
  });

  it('throws ProfileError when chartStates is not an array', () => {
    expect(() => parseProfileFields({ name: 'Scalper', chartStates: 'price:trend' })).toThrow(
      ProfileError,
    );
  });

  it('throws ProfileError when a chartStates element is not a string', () => {
    expect(() => parseProfileFields({ name: 'Scalper', chartStates: ['ok', 42] })).toThrow(
      ProfileError,
    );
  });
});

describe('mergeProfileFields', () => {
  it('overlays a patch and revalidates, keeping omitted fields', () => {
    const current: ProfileFields = {
      name: 'Scalper',
      description: 'fast',
      enabled: true,
      scope: { type: ProfileScope.All },
      chartStates: [],
    };
    expect(mergeProfileFields(current, { enabled: false })).toEqual({
      name: 'Scalper',
      description: 'fast',
      enabled: false,
      scope: { type: ProfileScope.All },
      chartStates: [],
    });
  });

  it('preserves the current chartStates when the patch omits it', () => {
    const current: ProfileFields = {
      name: 'Scalper',
      description: 'fast',
      enabled: true,
      scope: { type: ProfileScope.All },
      chartStates: ['price:trend'],
    };
    expect(mergeProfileFields(current, { enabled: false })).toEqual({
      name: 'Scalper',
      description: 'fast',
      enabled: false,
      scope: { type: ProfileScope.All },
      chartStates: ['price:trend'],
    });
  });

  it('replaces chartStates when the patch provides a new array', () => {
    const current: ProfileFields = {
      name: 'Scalper',
      description: 'fast',
      enabled: true,
      scope: { type: ProfileScope.All },
      chartStates: ['price:trend'],
    };
    expect(mergeProfileFields(current, { chartStates: ['rsi:zone'] })).toEqual({
      name: 'Scalper',
      description: 'fast',
      enabled: true,
      scope: { type: ProfileScope.All },
      chartStates: ['rsi:zone'],
    });
  });
});
