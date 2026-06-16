import { Theme } from './theme.types.js';

/**
 * `localStorage` key holding the user's theme choice.
 */
const STORAGE_KEY = 'theme';

/**
 * Read the persisted theme from `localStorage`, falling back to dark (the
 * app's default).
 */
export function getStoredTheme(): Theme {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === Theme.Light ? Theme.Light : Theme.Dark;
}

/**
 * Apply the persisted theme (or the dark-by-default fallback) to the `<html>`
 * element on app boot.
 *
 * Tailwind v4's `@custom-variant dark (&:where(.dark, .dark *))` keys off the
 * `dark` class on `<html>`, so this function adds/removes that class.
 */
export function applyInitialTheme(): void {
  applyTheme(getStoredTheme());
}

/**
 * Switch the active theme: update the `dark` class on `<html>` and persist
 * the choice so subsequent loads restore it.
 */
export function setTheme(theme: Theme): void {
  applyTheme(theme);
  window.localStorage.setItem(STORAGE_KEY, theme);
}

/**
 * Toggle `<html>.dark` to match the requested theme. Internal — call
 * {@link setTheme} to also persist the choice.
 */
function applyTheme(theme: Theme): void {
  if (theme === Theme.Dark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}
