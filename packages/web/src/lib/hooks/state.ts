import type { StateValue, StateValueType } from '@lametrader/core';
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-fetch.js';

/** Stable root for every state-related query key. */
export const STATE_QUERY_KEY = ['state'] as const;

/**
 * Polling cadence (ms) for the chart state-overlay queries.
 *
 * The events log is the upstream source of state mutations and has no
 * dedicated push channel today (the `chart-rule-events-live-stream.spec.md`
 * spec covers that work but hasn't shipped); polling every 5 s gives
 * "live updates within a few seconds" without standing up the WS plumbing.
 *
 * Lazy: replace with a stream subscription when the live-stream lands.
 */
const STATE_OVERLAY_REFETCH_MS = 5_000;

/** Stable key for the per-symbol state-map query. */
export function symbolStateKey(profileId: string, symbolId: string) {
  return [...STATE_QUERY_KEY, 'symbol', profileId, symbolId] as const;
}

/** Stable key for the global state-map query. */
export function globalStateKey(profileId: string) {
  return [...STATE_QUERY_KEY, 'global', profileId] as const;
}

/** Stable key for one symbol's state-key catalog. */
export function symbolStateKeysKey(symbolId: string) {
  return [...STATE_QUERY_KEY, 'symbol-state-keys', symbolId] as const;
}

/**
 * Stable key for one symbol's per-key state time-series, parameterised on
 * the visible window so a new `(from, to)` produces a fresh cache entry.
 */
export function symbolStateSeriesKey(input: {
  symbolId: string;
  key: string;
  from?: number;
  to?: number;
}) {
  return [
    ...STATE_QUERY_KEY,
    'symbol-state-series',
    input.symbolId,
    input.key,
    input.from,
    input.to,
  ] as const;
}

/**
 * Fetch a symbol's current rule-engine state map for a given profile
 * (`GET /symbols/:id/state?profileId=<id>`). Empty state resolves to `{}`;
 * an unwatched symbol surfaces as an `ApiError` (404). State is
 * partitioned by `profileId` per issue #281, so the caller must pass one;
 * the query is disabled when either `profileId` or `symbolId` is empty.
 */
export function useSymbolState(
  profileId: string,
  symbolId: string,
): UseQueryResult<Record<string, StateValue>, Error> {
  return useQuery({
    queryKey: symbolStateKey(profileId, symbolId),
    queryFn: () =>
      apiFetch<Record<string, StateValue>>(
        `/symbols/${encodeURIComponent(symbolId)}/state?profileId=${encodeURIComponent(profileId)}`,
      ),
    enabled: profileId !== '' && symbolId !== '',
  });
}

/**
 * Fetch the cross-symbol global rule-engine state map for a given profile
 * (`GET /profiles/:profileId/state/global`). Empty state resolves to `{}`.
 * The endpoint sits under `/profiles` since state is partitioned by
 * `profileId` (#281); the query is disabled when `profileId` is empty.
 */
export function useGlobalState(
  profileId: string,
): UseQueryResult<Record<string, StateValue>, Error> {
  return useQuery({
    queryKey: globalStateKey(profileId),
    queryFn: () =>
      apiFetch<Record<string, StateValue>>(
        `/profiles/${encodeURIComponent(profileId)}/state/global`,
      ),
    enabled: profileId !== '',
  });
}

/**
 * One row returned by {@link useSymbolStateKeys} — a known state key the
 * symbol has been written under, and the value variant the chart should
 * render with (numeric → step line; bool/string/enum → markers).
 */
export interface SymbolStateKey {
  /** The state key (e.g. `'last_signal'`). */
  key: string;
  /** The variant of the latest observed value for this key. */
  valueType: StateValueType;
}

/**
 * Read the catalog of known state-keys for a watched symbol
 * (`GET /symbols/:id/state-keys`).
 *
 * Re-fetches on a {@link STATE_OVERLAY_REFETCH_MS} cadence so freshly-set
 * keys appear in the picker without a manual reload (no push channel today
 * — see the constant's JSDoc).
 *
 * The endpoint is not partitioned by profile — `RuleEventEntry` carries no
 * `profileId` today, so the picker shows every key persisted on the symbol
 * regardless of which profile's rule wrote it (see issue #434 design notes).
 */
export function useSymbolStateKeys(symbolId: string): UseQueryResult<SymbolStateKey[], Error> {
  return useQuery({
    queryKey: symbolStateKeysKey(symbolId),
    queryFn: () =>
      apiFetch<SymbolStateKey[]>(`/symbols/${encodeURIComponent(symbolId)}/state-keys`),
    refetchInterval: STATE_OVERLAY_REFETCH_MS,
  });
}

/**
 * Input to {@link useSymbolStateTimeSeries} — the symbol + key the series
 * belongs to, plus the optional `[from, to)` window (epoch ms).
 */
export interface SymbolStateTimeSeriesInput {
  /** The watched symbol id. */
  symbolId: string;
  /** The state key to read. */
  key: string;
  /** Inclusive lower bound on returned entries' `ts`. */
  from?: number;
  /** Exclusive upper bound on returned entries' `ts`. */
  to?: number;
}

/**
 * One sample on a state key's time-series — the wire shape returned by
 * `GET /symbols/:id/state/:key/series`. `value === null` marks a
 * `StateRemoved` event.
 */
export interface SymbolStateTimeSeriesEntry {
  /** Source timestamp from the originating rule event (epoch ms). */
  ts: number;
  /** The new value at `ts`, or `null` when the key was removed at `ts`. */
  value: StateValue | null;
}

/**
 * TanStack Query options for one state-key's time-series — extracted so the
 * chart page can pass an array of these to `useQueries` (one per selected
 * key), while the single-key form remains the plain hook below.
 *
 * Same polling cadence as {@link useSymbolStateKeys} — a fresh `StateSet` /
 * `StateRemoved` in the visible window surfaces on the chart without a
 * manual refetch.
 */
export function symbolStateTimeSeriesQueryOptions(input: SymbolStateTimeSeriesInput) {
  const params = new URLSearchParams();
  if (input.from !== undefined) params.set('from', String(input.from));
  if (input.to !== undefined) params.set('to', String(input.to));
  const qs = params.toString();
  return {
    queryKey: symbolStateSeriesKey(input),
    queryFn: () =>
      apiFetch<SymbolStateTimeSeriesEntry[]>(
        `/symbols/${encodeURIComponent(input.symbolId)}/state/${encodeURIComponent(input.key)}/series${qs ? `?${qs}` : ''}`,
      ),
    refetchInterval: STATE_OVERLAY_REFETCH_MS,
  };
}

/**
 * Read one state-key's time-series for a watched symbol
 * (`GET /symbols/:id/state/:key/series?from=&to=`).
 *
 * Returns the series ascending by `ts`; the chart consumer maps the entries
 * into series points (numeric) or markers (bool/string/enum).
 */
export function useSymbolStateTimeSeries(
  input: SymbolStateTimeSeriesInput,
): UseQueryResult<SymbolStateTimeSeriesEntry[], Error> {
  return useQuery(symbolStateTimeSeriesQueryOptions(input));
}
