import { type Profile, ProfileScope } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { resolveSelectedProfileId } from './resolve-selected-profile.js';

/** Build a profile with the given id and enabled flag (other fields fixed). */
const profile = (id: string, enabled: boolean): Profile => ({
  id,
  name: `Profile ${id}`,
  description: '',
  enabled,
  scope: { type: ProfileScope.All },
  createdAt: 0,
  updatedAt: 0,
  indicators: [],
});

describe('resolveSelectedProfileId', () => {
  it('keeps the stored id when it names a listed profile', () => {
    const profiles = [profile('a', true), profile('b', true)];
    expect(resolveSelectedProfileId(profiles, 'b')).toEqual('b');
  });

  it('falls back to the first enabled profile when nothing is stored', () => {
    const profiles = [profile('a', false), profile('b', true)];
    expect(resolveSelectedProfileId(profiles, null)).toEqual('b');
  });

  it('falls back to the first enabled profile when the stored id names no listed profile', () => {
    const profiles = [profile('a', false), profile('b', true)];
    expect(resolveSelectedProfileId(profiles, 'deleted')).toEqual('b');
  });

  it('returns null when there are no profiles', () => {
    expect(resolveSelectedProfileId([], 'whatever')).toEqual(null);
  });
});
