import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import { getStoredProfileId, setStoredProfileId } from './selected-profile.js';

/**
 * The selected-profile Context value: the currently selected profile id (or
 * `null` when nothing is selected) plus a setter that writes through to
 * `localStorage` via {@link setStoredProfileId}.
 */
interface SelectedProfileContextValue {
  /** The currently selected profile id, or `null` when nothing is selected. */
  profileId: string | null;
  /**
   * Set the selected profile id; passing `null` clears the selection. The
   * change is written through to `localStorage` synchronously so a reload
   * immediately after picks up the latest value.
   */
  setProfileId: (id: string | null) => void;
}

const SelectedProfileContext = createContext<SelectedProfileContextValue | null>(null);

/**
 * Provider for the global selected-profile store. Hydrates the initial value
 * from `localStorage` once at mount; every {@link setProfileId} call writes
 * through to storage synchronously.
 *
 * Mounted once at the app shell so any descendant (the chart's picker today,
 * the indicator overlays tomorrow) reads the same selection.
 */
export function SelectedProfileProvider({ children }: { children: ReactNode }): ReactNode {
  const [profileId, setProfileIdState] = useState<string | null>(getStoredProfileId);
  const setProfileId = useCallback((next: string | null) => {
    setStoredProfileId(next);
    setProfileIdState(next);
  }, []);
  return (
    <SelectedProfileContext.Provider value={{ profileId, setProfileId }}>
      {children}
    </SelectedProfileContext.Provider>
  );
}

/**
 * Access the global selected-profile state. Must be called from inside a
 * {@link SelectedProfileProvider}.
 */
export function useSelectedProfile(): SelectedProfileContextValue {
  const value = useContext(SelectedProfileContext);
  if (!value) {
    throw new Error('useSelectedProfile must be used inside <SelectedProfileProvider>');
  }
  return value;
}
