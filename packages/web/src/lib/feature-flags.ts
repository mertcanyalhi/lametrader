import { getLogger } from './log.js';

/**
 * Scoped logger for the feature-flags surface. Every entry carries
 * `scope: 'feature-flags'` so it can be filtered out of the console.
 */
const log = getLogger('feature-flags');

/**
 * The `localStorage` key the rules-v2 flag is persisted under.
 *
 * `true` (string) ⇒ on; anything else (or absent) ⇒ off.
 * The flag also reads from the URL `?rulesV2=1` query param so it can be flipped
 * from a browser without typing into devtools — useful for sharing test links.
 */
export const RULES_V2_STORAGE_KEY = 'rulesV2Enabled';

/**
 * The URL query parameter that unlocks the rules-v2 flag for the current
 * session. Wins over `localStorage` so a shared link always opens the v2
 * surface even on a browser where the flag has never been flipped.
 */
export const RULES_V2_URL_PARAM = 'rulesV2';

/**
 * Read the rules-v2 feature flag.
 *
 * Resolves to `true` when either:
 * - the URL carries `?rulesV2=1` (also accepts `true` / `on`), or
 * - `localStorage.rulesV2Enabled === 'true'`.
 *
 * Everything else (the param missing or set to `0` / `false` / `off`, no
 * `localStorage` entry, a thrown `localStorage` access in a private-mode
 * browser) resolves to `false`.
 *
 * Safe to call during render — never throws.
 *
 * @param search - optional override of the URL search string (test seam);
 *                 defaults to `window.location.search`.
 */
export function isRulesV2Enabled(search?: string): boolean {
  const fromUrl = readUrlFlag(search ?? readLocationSearch());
  if (fromUrl !== undefined) return fromUrl;
  return readStorageFlag();
}

/**
 * Best-effort `window.location.search` read — returns `''` when running in a
 * non-DOM environment (jsdom is fine; SSR builds and unit tests that don't set
 * up the global aren't).
 */
function readLocationSearch(): string {
  if (typeof window === 'undefined') return '';
  return window.location.search;
}

/**
 * Read the URL-param branch of the flag.
 *
 * Returns `true` for `?rulesV2=1` / `true` / `on`, `false` for `0` / `false` /
 * `off`, and `undefined` when the param is absent (so `localStorage` can decide).
 */
function readUrlFlag(search: string): boolean | undefined {
  if (search === '') return undefined;
  const params = new URLSearchParams(search);
  const raw = params.get(RULES_V2_URL_PARAM);
  if (raw === null) return undefined;
  const normalized = raw.toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'on') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'off') return false;
  return undefined;
}

/**
 * Read the `localStorage` branch of the flag.
 *
 * Returns `false` when storage isn't available or the value isn't the literal
 * string `'true'` — never throws.
 */
function readStorageFlag(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(RULES_V2_STORAGE_KEY) === 'true';
  } catch (cause) {
    log.warn({ err: cause }, 'localStorage read failed; defaulting flag to off');
    return false;
  }
}
