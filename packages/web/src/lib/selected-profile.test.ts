// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  getStoredProfileId,
  SELECTED_PROFILE_STORAGE_KEY,
  setStoredProfileId,
} from './selected-profile.js';

describe('selected-profile persistence', () => {
  afterEach(() => window.localStorage.clear());

  it('round-trips a stored profile id through localStorage under the documented key', () => {
    setStoredProfileId('p-1');

    expect({
      get: getStoredProfileId(),
      raw: window.localStorage.getItem(SELECTED_PROFILE_STORAGE_KEY),
    }).toEqual({ get: 'p-1', raw: 'p-1' });
  });

  it('returns null when no profile id has been stored', () => {
    expect(getStoredProfileId()).toEqual(null);
  });

  it('removes the key entirely when set to null', () => {
    setStoredProfileId('p-1');

    setStoredProfileId(null);

    expect({
      get: getStoredProfileId(),
      raw: window.localStorage.getItem(SELECTED_PROFILE_STORAGE_KEY),
    }).toEqual({ get: null, raw: null });
  });
});
