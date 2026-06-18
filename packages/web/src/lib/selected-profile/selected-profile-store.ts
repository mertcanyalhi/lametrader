/**
 * `localStorage` key holding the id of the currently selected profile.
 */
const STORAGE_KEY = 'selected-profile';

/**
 * Read the persisted selected profile id, or `null` when nothing is stored.
 *
 * Only the id is persisted — the profile objects themselves are server state
 * (`useProfiles`), so a stored id is reconciled against the fetched list by
 * {@link resolveSelectedProfileId} before it drives the UI.
 */
export function getStoredProfileId(): string | null {
  return window.localStorage.getItem(STORAGE_KEY);
}

/**
 * Persist the selected profile id so the next load restores it. Passing `null`
 * clears the stored selection.
 */
export function setStoredProfileId(id: string | null): void {
  if (id === null) {
    window.localStorage.removeItem(STORAGE_KEY);
  } else {
    window.localStorage.setItem(STORAGE_KEY, id);
  }
}
