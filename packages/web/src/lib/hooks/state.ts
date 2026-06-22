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
