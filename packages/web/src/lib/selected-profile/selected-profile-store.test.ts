// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { getStoredProfileId, setStoredProfileId } from './selected-profile-store.js';

/**
 * Tests for the `localStorage`-backed selected-profile store — the single place
 * that reads/writes the persisted selected profile id (components never touch
 * `localStorage` directly, per the web CLAUDE.md).
 */
describe('selected-profile-store', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('returns null when no profile id has been stored', () => {
    expect(getStoredProfileId()).toEqual(null);
  });

  it('persists an id that getStoredProfileId then reads back', () => {
    setStoredProfileId('profile-1');
    expect(getStoredProfileId()).toEqual('profile-1');
  });

  it('clears the stored id when set to null', () => {
    setStoredProfileId('profile-1');
    setStoredProfileId(null);
    expect(getStoredProfileId()).toEqual(null);
  });
});
