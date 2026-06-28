import type { StateValue } from '@lametrader/core';
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-fetch.js';

/** Stable root for every state-related query key. */
export const STATE_QUERY_KEY = ['state'] as const;

/** Stable key for the per-symbol state-map query. */
export function symbolStateKey(symbolId: string) {
  return [...STATE_QUERY_KEY, 'symbol', symbolId] as const;
}

/** Stable key for the global state-map query. */
export function globalStateKey() {
  return [...STATE_QUERY_KEY, 'global'] as const;
}

/** Stable key for the profile-scoped global state-map query. */
export function profileGlobalStateKey(profileId: string) {
  return [...STATE_QUERY_KEY, 'global', profileId] as const;
}

/** Stable key for the profile-scoped per-symbol state-map query. */
export function profileSymbolStateKey(profileId: string, symbolId: string) {
  return [...STATE_QUERY_KEY, 'symbol', profileId, symbolId] as const;
}

/**
 * Fetch a symbol's current rule-engine state map
 * (`GET /symbols/:id/state`). Empty state resolves to `{}`; an unwatched
 * symbol surfaces as an `ApiError` (404).
 */
export function useSymbolState(
  symbolId: string,
): UseQueryResult<Record<string, StateValue>, Error> {
  return useQuery({
    queryKey: symbolStateKey(symbolId),
    queryFn: () =>
      apiFetch<Record<string, StateValue>>(`/symbols/${encodeURIComponent(symbolId)}/state`),
  });
}

/**
 * Fetch the cross-symbol global rule-engine state map
 * (`GET /state/global`). Empty state resolves to `{}`.
 */
export function useGlobalState(): UseQueryResult<Record<string, StateValue>, Error> {
  return useQuery({
    queryKey: globalStateKey(),
    queryFn: () => apiFetch<Record<string, StateValue>>('/state/global'),
  });
}

/**
 * Fetch a profile's global rule-engine state map
 * (`GET /profiles/:profileId/state/global`). Empty state resolves to `{}`.
 * Skipped (disabled query) when no `profileId` is supplied.
 *
 * Used by the v2 rule editor to seed `GlobalStateRef` key dropdowns with the
 * profile's already-known state keys (per #396 AC).
 */
export function useProfileGlobalState(
  profileId: string | undefined,
): UseQueryResult<Record<string, StateValue>, Error> {
  return useQuery({
    queryKey: profileGlobalStateKey(profileId ?? ''),
    queryFn: () =>
      apiFetch<Record<string, StateValue>>(
        `/profiles/${encodeURIComponent(profileId ?? '')}/state/global`,
      ),
    enabled: profileId !== undefined && profileId !== '',
  });
}

/**
 * Fetch a symbol's per-profile rule-engine state map
 * (`GET /symbols/:symbolId/state?profileId=...`). Empty state resolves to `{}`.
 * Skipped (disabled query) when either id is missing.
 *
 * Used by the v2 rule editor to seed `SymbolStateRef` key dropdowns with the
 * symbol's already-known state keys (per #396 AC).
 */
export function useProfileSymbolState(
  profileId: string | undefined,
  symbolId: string | undefined,
): UseQueryResult<Record<string, StateValue>, Error> {
  return useQuery({
    queryKey: profileSymbolStateKey(profileId ?? '', symbolId ?? ''),
    queryFn: () => {
      const qs = new URLSearchParams({ profileId: profileId ?? '' }).toString();
      return apiFetch<Record<string, StateValue>>(
        `/symbols/${encodeURIComponent(symbolId ?? '')}/state?${qs}`,
      );
    },
    enabled:
      profileId !== undefined && profileId !== '' && symbolId !== undefined && symbolId !== '',
  });
}
