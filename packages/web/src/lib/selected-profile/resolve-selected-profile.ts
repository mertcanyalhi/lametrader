import type { Profile } from '@lametrader/core';

/**
 * Reconcile a persisted selected profile id against the profiles the server
 * actually returned, yielding the id that should drive the UI.
 *
 * - Keeps `selectedId` when it still names a listed profile.
 * - Otherwise falls back to the first **enabled** profile (the first-run
 *   default, and the recovery when the stored profile was deleted/renamed away).
 * - Returns `null` when there are no profiles (or none enabled) — the
 *   "No profile" state.
 *
 * @param profiles - the profiles fetched from the server, in display order.
 * @param selectedId - the persisted selection, or `null` when none is stored.
 */
export function resolveSelectedProfileId(
  profiles: Profile[],
  selectedId: string | null,
): string | null {
  if (selectedId !== null && profiles.some((profile) => profile.id === selectedId)) {
    return selectedId;
  }
  return profiles.find((profile) => profile.enabled)?.id ?? null;
}
