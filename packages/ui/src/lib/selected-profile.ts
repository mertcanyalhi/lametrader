import { getLogger } from './log.js';

/** Scoped logger for selected-profile persistence. */
const log = getLogger('selected-profile');

/** localStorage key under which the currently selected profile id is persisted. */
export const SELECTED_PROFILE_STORAGE_KEY = 'lametrader.selectedProfileId';

/**
 * Read the persisted selected profile id, or `null` when none is stored
 * (or localStorage is unavailable). The caller still validates that the id
 * exists in the loaded profile list — a stale id is treated as "No profile".
 */
export function getStoredProfileId(): string | null {
  try {
    return window.localStorage.getItem(SELECTED_PROFILE_STORAGE_KEY);
  } catch (cause) {
    log.warn({ err: cause }, 'failed to read stored selected profile');
    return null;
  }
}

/**
 * Persist the selected profile id so the choice survives reloads and new
 * tabs. Passing `null` removes the key entirely (an empty string isn't a
 * valid id, so it's never stored).
 */
export function setStoredProfileId(id: string | null): void {
  try {
    if (id === null) {
      window.localStorage.removeItem(SELECTED_PROFILE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(SELECTED_PROFILE_STORAGE_KEY, id);
    }
  } catch (cause) {
    log.warn({ err: cause }, 'failed to persist selected profile');
  }
}
