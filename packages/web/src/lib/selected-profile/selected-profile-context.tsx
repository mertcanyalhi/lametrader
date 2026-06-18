import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import { getStoredProfileId, setStoredProfileId } from './selected-profile-store.js';

/**
 * The global selected-profile state: the selected profile id (or `null` for
 * "No profile") plus a setter that both updates state and persists the choice.
 */
interface SelectedProfileContextValue {
  /** The currently selected profile id, or `null` when none is selected. */
  profileId: string | null;
  /** Select a profile (or `null`): writes through to `localStorage` and re-renders subscribers. */
  setProfileId: (id: string | null) => void;
}

/**
 * Context carrying the selected profile. Consumers read it via
 * {@link useSelectedProfile}.
 */
const SelectedProfileStateContext = createContext<SelectedProfileContextValue | null>(null);

/**
 * Provider that lifts the selected-profile state out of the bottom-bar selector
 * so every consumer (the selector now, chart overlays later) shares one source
 * of truth. The initial value is hydrated from `localStorage`, mirroring
 * `ThemeProvider`.
 */
export function SelectedProfileProvider({ children }: { children: ReactNode }): ReactNode {
  const [profileId, setProfileIdState] = useState<string | null>(getStoredProfileId);
  const setProfileId = useCallback((id: string | null): void => {
    setStoredProfileId(id);
    setProfileIdState(id);
  }, []);
  return (
    <SelectedProfileStateContext.Provider value={{ profileId, setProfileId }}>
      {children}
    </SelectedProfileStateContext.Provider>
  );
}

/**
 * Read the selected profile id + setter from the surrounding
 * {@link SelectedProfileProvider}. Throws when no provider is mounted — the
 * shell wires one in `AppShell`, so the error means a component rendered
 * outside the shell (likely a bug).
 */
export function useSelectedProfile(): SelectedProfileContextValue {
  const value = useContext(SelectedProfileStateContext);
  if (value === null) {
    throw new Error('useSelectedProfile must be used inside a <SelectedProfileProvider>');
  }
  return value;
}
