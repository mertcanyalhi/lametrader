import { getLogger } from './log.js';

/** Scoped logger for chart state-overlay persistence. */
const log = getLogger('chart-state-overlays');

/**
 * localStorage prefix under which the chart's currently overlaid state keys
 * are persisted, namespaced by `(profileId, symbolId)`.
 *
 * Stored as a JSON array of strings so the same key order survives
 * round-trips and the empty case is `[]` (not absent).
 */
const STORAGE_PREFIX = 'chart-state-overlays';

/** Compose the storage key for one `(profileId, symbolId)` pair. */
function storageKey(profileId: string, symbolId: string): string {
  return `${STORAGE_PREFIX}::${profileId}::${symbolId}`;
}

/**
 * Read the persisted set of overlaid state-keys for `(profileId, symbolId)`.
 *
 * Returns `[]` when nothing is stored, the value isn't a JSON array of
 * strings, or `localStorage` is unavailable — every error path falls back
 * to the empty set so the chart never blocks on a parse failure.
 */
export function getStoredStateOverlays(profileId: string, symbolId: string): string[] {
  try {
    const raw = window.localStorage.getItem(storageKey(profileId, symbolId));
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === 'string');
  } catch (cause) {
    log.warn({ err: cause, profileId, symbolId }, 'failed to read stored state overlays');
    return [];
  }
}

/**
 * Persist the set of overlaid state-keys for `(profileId, symbolId)`.
 *
 * Writes the JSON form of `keys` so subsequent reads round-trip exactly.
 * Failures are logged via the scope's Pino logger and swallowed — a
 * storage-quota error shouldn't crash the chart UI.
 */
export function setStoredStateOverlays(
  profileId: string,
  symbolId: string,
  keys: readonly string[],
): void {
  try {
    window.localStorage.setItem(storageKey(profileId, symbolId), JSON.stringify(keys));
  } catch (cause) {
    log.warn({ err: cause, profileId, symbolId }, 'failed to persist state overlays');
  }
}
