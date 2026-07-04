import { getLogger } from './log.js';

/** Scoped logger for chart-symbol persistence. */
const log = getLogger('chart-symbol');

/** localStorage key under which the chart's last-selected symbol id is persisted. */
const STORAGE_KEY = 'chart-symbol';

/**
 * Read the persisted chart symbol id, or `null` when none is stored (or the
 * stored value isn't a non-empty string / localStorage is unavailable). The
 * caller still decides whether the symbol is in the current watchlist.
 */
export function getStoredSymbolId(): string | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw !== null && raw.length > 0 ? raw : null;
  } catch (cause) {
    log.warn({ err: cause }, 'failed to read stored chart symbol');
    return null;
  }
}

/**
 * Persist the chart's selected symbol id so a bare `/chart` (e.g. the sidebar
 * Chart link) reopens on it instead of falling back to the first watched symbol.
 */
export function setStoredSymbolId(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch (cause) {
    log.warn({ err: cause }, 'failed to persist chart symbol');
  }
}
