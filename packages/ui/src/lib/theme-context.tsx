import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import { getStoredTheme, setTheme as persistTheme } from './theme.js';
import type { Theme } from './theme.types.js';

/**
 * React state shape exposed by {@link ThemeProvider}. The current theme plus a
 * setter that both flips the `dark` class on `<html>` (via {@link persistTheme})
 * and updates the React state so subscribed components re-render.
 */
interface ThemeContextValue {
  /** The currently active theme. */
  theme: Theme;
  /** Switch theme: writes through to `localStorage` and updates the `<html>` class. */
  setTheme: (next: Theme) => void;
}

/**
 * Context for the active theme. Consumers read it via {@link useTheme}.
 */
const ThemeStateContext = createContext<ThemeContextValue | null>(null);

/**
 * Provider that lifts the theme state out of any individual button so the
 * Radix Themes `<Theme appearance>` and the topbar's toggle stay in sync.
 *
 * Initial value is read from `localStorage` (with the dark default applied by
 * `applyInitialTheme` before React mounts), so the first paint and React's
 * state agree.
 */
export function ThemeProvider({ children }: { children: ReactNode }): ReactNode {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);
  const setTheme = useCallback((next: Theme): void => {
    persistTheme(next);
    setThemeState(next);
  }, []);
  return (
    <ThemeStateContext.Provider value={{ theme, setTheme }}>{children}</ThemeStateContext.Provider>
  );
}

/**
 * Read the active theme + setter from the surrounding {@link ThemeProvider}.
 * Throws if no provider is mounted — the shell wires one in `AppShell`, so the
 * error means a component is being rendered outside the shell (likely a bug).
 */
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeStateContext);
  if (value === null) {
    throw new Error('useTheme must be used inside a <ThemeProvider>');
  }
  return value;
}
