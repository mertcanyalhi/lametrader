import type {
  EnrichedSymbol,
  Instrument,
  Period,
  SymbolType,
  WatchedSymbol,
} from '@lametrader/core';
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiFetch } from '../api-fetch.js';

/**
 * Stable key for the enriched watchlist query. The mutations below invalidate
 * it so a successful add/edit/remove refetches the table from the server.
 */
export const WATCHLIST_QUERY_KEY = ['symbols', 'enrich'] as const;

/**
 * Fetch the watched symbols enriched with their snapshot quotes
 * (`GET /symbols?enrich=true`). The watchlist table binds to this hook.
 */
export function useWatchlist(): UseQueryResult<EnrichedSymbol[], Error> {
  return useQuery({
    queryKey: WATCHLIST_QUERY_KEY,
    queryFn: () => apiFetch<EnrichedSymbol[]>('/symbols?enrich=true'),
  });
}

/**
 * Search the provider catalogs for instruments to add (`GET /instruments`).
 * Disabled until `query` is non-empty so an empty search box issues no request;
 * an optional `type` narrows the asset class.
 *
 * @param query - the (debounced) search text.
 * @param type - optional asset-class filter.
 */
export function useSearchInstruments(
  query: string,
  type?: SymbolType,
): UseQueryResult<Instrument[], Error> {
  const params = new URLSearchParams({ q: query });
  if (type) params.set('type', type);
  return useQuery({
    queryKey: ['instruments', query, type ?? null],
    queryFn: () => apiFetch<Instrument[]>(`/instruments?${params.toString()}`),
    enabled: query.trim().length > 0,
  });
}

/** The payload for adding a symbol — its id plus the periods to watch. */
export interface AddSymbolInput {
  /** Canonical instrument id, e.g. `"crypto:BTCUSDT"`. */
  id: string;
  /**
   * Periods to watch for the new symbol. Omitted when the config hasn't loaded,
   * so the server falls back to the global default periods.
   */
  periods?: Period[];
}

/**
 * Add a symbol to the watchlist (`POST /symbols`). On success, invalidates the
 * watchlist query so the table refetches with the new row.
 */
export function useAddSymbol(): UseMutationResult<WatchedSymbol, Error, AddSymbolInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, periods }: AddSymbolInput) =>
      apiFetch<WatchedSymbol>('/symbols', {
        method: 'POST',
        body: JSON.stringify(periods ? { id, periods } : { id }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WATCHLIST_QUERY_KEY }),
  });
}

/** The payload for editing a symbol's watched periods. */
export interface UpdatePeriodsInput {
  /** Canonical instrument id of the symbol to update. */
  id: string;
  /** The full new set of periods to watch. */
  periods: Period[];
}

/**
 * Replace a symbol's watched periods (`PATCH /symbols/:id`). On success,
 * invalidates the watchlist query so the table refetches.
 */
export function useUpdatePeriods(): UseMutationResult<WatchedSymbol, Error, UpdatePeriodsInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, periods }: UpdatePeriodsInput) =>
      apiFetch<WatchedSymbol>(`/symbols/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ periods }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WATCHLIST_QUERY_KEY }),
  });
}

/**
 * Remove a symbol from the watchlist (`DELETE /symbols/:id`). On success,
 * invalidates the watchlist query so the row disappears.
 */
export function useRemoveSymbol(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/symbols/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WATCHLIST_QUERY_KEY }),
  });
}
