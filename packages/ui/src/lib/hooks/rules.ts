import type { Rule, RuleEventEntry } from '@lametrader/core';
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiFetch } from '../api-fetch.js';
import { StreamKind } from '../stream/stream-client.types.js';
import { useStreamSubscription } from '../stream/use-stream-subscription.js';
import { STATE_QUERY_KEY } from './state.js';

/** Stable root for every rules-related query key. */
export const RULES_QUERY_KEY = ['rules'] as const;

/** Stable key for the rule-list query, parameterized by filters. */
export function rulesListKey(
  filters: { profileId?: string; symbolId?: string; enabled?: boolean } = {},
) {
  return [...RULES_QUERY_KEY, 'list', filters] as const;
}

/** Stable key for one rule's detail query. */
export function ruleKey(id: string) {
  return [...RULES_QUERY_KEY, 'detail', id] as const;
}

/** Stable key for one rule's events query. */
export function ruleEventsKey(id: string, options: { limit?: number; before?: number } = {}) {
  return [...RULES_QUERY_KEY, 'events', id, options] as const;
}

/** Stable key for one symbol's mirrored events query. */
export function symbolRuleEventsKey(
  symbolId: string,
  options: { limit?: number; before?: number } = {},
) {
  return [...RULES_QUERY_KEY, 'symbol-events', symbolId, options] as const;
}

/** Stable key for one symbol's mirrored events count query. */
export function symbolRuleEventsCountKey(symbolId: string) {
  return [...RULES_QUERY_KEY, 'symbol-events-count', symbolId] as const;
}

/**
 * Stable key for one symbol's mirrored events query windowed by `[from, to)`
 * and filtered to the chart's selected state keys.
 *
 * Parameterized by both bounds AND the state-key filter, so a window pan /
 * zoom OR a States-panel selection change invalidates and refetches cleanly.
 */
export function symbolRuleEventsRangeKey(
  symbolId: string,
  from: number | undefined,
  to: number | undefined,
  chartStates: readonly string[],
) {
  return [...RULES_QUERY_KEY, 'symbol-events-range', symbolId, from, to, chartStates] as const;
}

/**
 * The body `POST /rules` / `PATCH /rules/:id` accept.
 *
 * Same shape as the persisted {@link Rule} minus server-generated
 * identity / timestamps; the controller (#395) re-validates this against the
 * boundary schema before persisting.
 */
export type RuleInput = Omit<Rule, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Filter set for `GET /rules`.
 *
 * Every filter is optional and independent; the server combines them with AND.
 */
export interface RulesListFilters {
  /** Restrict to a single profile. */
  profileId?: string;
  /** Restrict to rules whose scope mentions this symbol. */
  symbolId?: string;
  /** Restrict to enabled (`true`) or disabled (`false`) rules. */
  enabled?: boolean;
}

/**
 * List rules (`GET /rules?profileId=&symbolId=&enabled=`).
 *
 * Every filter is optional and independent; the server combines them with AND.
 */
export function useRules(filters: RulesListFilters = {}): UseQueryResult<Rule[], Error> {
  const search = new URLSearchParams();
  if (filters.profileId !== undefined) search.set('profileId', filters.profileId);
  if (filters.symbolId !== undefined) search.set('symbolId', filters.symbolId);
  if (filters.enabled !== undefined) search.set('enabled', String(filters.enabled));
  const qs = search.toString();
  return useQuery({
    queryKey: rulesListKey(filters),
    queryFn: () => apiFetch<Rule[]>(qs ? `/rules?${qs}` : '/rules'),
  });
}

/** Fetch one rule by id (`GET /rules/:id`). */
export function useRule(id: string): UseQueryResult<Rule, Error> {
  return useQuery({
    queryKey: ruleKey(id),
    queryFn: () => apiFetch<Rule>(`/rules/${encodeURIComponent(id)}`),
  });
}

/**
 * Create a rule (`POST /rules`).
 *
 * Invalidates every rules query on success so the list refetches.
 */
export function useCreateRule(): UseMutationResult<Rule, Error, RuleInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RuleInput) =>
      apiFetch<Rule>('/rules', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RULES_QUERY_KEY }),
  });
}

/** Body the {@link usePatchRule} mutation takes — id + the partial patch. */
export interface PatchRuleInput {
  /** The rule id to patch. */
  id: string;
  /** The partial body; the server merges it with the persisted rule and re-validates. */
  patch: Partial<RuleInput>;
}

/**
 * Patch a rule (`PATCH /rules/:id`).
 *
 * Same validation envelope as create — the controller re-validates the merged
 * result. Invalidates every rules query on success.
 */
export function usePatchRule(): UseMutationResult<Rule, Error, PatchRuleInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: PatchRuleInput) =>
      apiFetch<Rule>(`/rules/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RULES_QUERY_KEY }),
  });
}

/**
 * Delete a rule (`DELETE /rules/:id`).
 *
 * Invalidates every rules query on success.
 */
export function useDeleteRule(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/rules/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RULES_QUERY_KEY }),
  });
}

/**
 * Paginated read of one rule's events log
 * (`GET /rules/:id/events?limit=&before=`), newest-first.
 *
 * `limit` defaults to 50 server-side; `before` is a strict `<` cursor on `ts`
 * for "next page".
 */
export function useRuleEvents(
  id: string,
  options: { limit?: number; before?: number } = {},
): UseQueryResult<RuleEventEntry[], Error> {
  const search = new URLSearchParams();
  if (options.limit !== undefined) search.set('limit', String(options.limit));
  if (options.before !== undefined) search.set('before', String(options.before));
  const qs = search.toString();
  const path = `/rules/${encodeURIComponent(id)}/events${qs ? `?${qs}` : ''}`;
  return useQuery({
    queryKey: ruleEventsKey(id, options),
    queryFn: () => apiFetch<RuleEventEntry[]>(path),
  });
}

/**
 * Paginated read of one symbol's mirrored events log
 * (`GET /symbols/:id/rule-events?limit=&before=`), newest-first.
 *
 * Same pagination semantics as {@link useRuleEvents} — `limit` defaults to 50
 * server-side, `before` is a strict `<` cursor on `ts`.
 */
export function useSymbolRuleEvents(
  symbolId: string,
  options: { limit?: number; before?: number } = {},
): UseQueryResult<RuleEventEntry[], Error> {
  const search = new URLSearchParams();
  if (options.limit !== undefined) search.set('limit', String(options.limit));
  if (options.before !== undefined) search.set('before', String(options.before));
  const qs = search.toString();
  const path = `/symbols/${encodeURIComponent(symbolId)}/rule-events${qs ? `?${qs}` : ''}`;
  return useQuery({
    queryKey: symbolRuleEventsKey(symbolId, options),
    queryFn: () => apiFetch<RuleEventEntry[]>(path),
  });
}

/**
 * Count of one symbol's mirrored events
 * (`GET /symbols/:id/rule-events/count`). Backs the chart-page Events button
 * badge — caps rendered display at `99+` in the consumer, but the hook
 * returns the raw integer.
 */
export function useSymbolRuleEventsCount(symbolId: string): UseQueryResult<number, Error> {
  return useQuery({
    queryKey: symbolRuleEventsCountKey(symbolId),
    queryFn: async () => {
      const body = await apiFetch<{ count: number }>(
        `/symbols/${encodeURIComponent(symbolId)}/rule-events/count`,
      );
      return body.count;
    },
  });
}

/** Hard cap on rows fetched per windowed range read (matches the API ceiling). */
export const RULE_EVENTS_RANGE_LIMIT = 500;

/**
 * Read one symbol's mirrored events log windowed by `[from, to)` and filtered
 * to the chart's selected state keys
 * (`GET /symbols/:id/rule-events?from=&to=&limit=500&chartStates=`).
 *
 * Backs the chart's rule-event markers — the chart's visible window maps
 * directly onto `from` / `to`, and `chartStates` (a JSON-encoded array of the
 * States-panel-selected keys) keeps only the `stateSet` / `stateRemoved`
 * markers for those keys (an empty selection renders nothing). Always sent, so
 * the read filters even with no selection — unlike the Events list dialog /
 * count, which omit it and stay unfiltered.
 *
 * Disabled when either bound is `undefined` (the chart hasn't loaded enough
 * candles to know its visible range yet), so no stray request fires.
 */
export function useRuleEventsForRange(
  symbolId: string,
  from: number | undefined,
  to: number | undefined,
  chartStates: readonly string[],
): UseQueryResult<RuleEventEntry[], Error> {
  return useQuery({
    queryKey: symbolRuleEventsRangeKey(symbolId, from, to, chartStates),
    queryFn: () => {
      const search = new URLSearchParams();
      search.set('from', String(from));
      search.set('to', String(to));
      search.set('limit', String(RULE_EVENTS_RANGE_LIMIT));
      search.set('chartStates', JSON.stringify(chartStates));
      return apiFetch<RuleEventEntry[]>(
        `/symbols/${encodeURIComponent(symbolId)}/rule-events?${search}`,
      );
    },
    enabled: from !== undefined && to !== undefined,
  });
}

/**
 * Subscribe to one symbol's live rule-event feed
 * (`subscribe-rule-event` over the shared stream client).
 *
 * Each inbound frame invalidates the whole {@link RULES_QUERY_KEY} root so
 * every rules query refetches — the chart's windowed markers
 * (`symbol-events-range`), the Events badge count, AND the Events dialog list
 * (`symbol-events`) / per-rule events (`events`), which are keyed separately
 * and would otherwise stay stale until a window refocus / reload.
 * A rule-event frame is also the signal that rule-engine state may have changed
 * (`StateSet` / `StateRemoved` events are mirrored to the symbol feed), so the
 * whole `STATE_QUERY_KEY` root is invalidated too — the states panel's
 * current-value map has no poll of its own.
 * Renders nothing — sit it as a child of the chart layout for one-symbol-per-page.
 */
export function useRuleEventStream(symbolId: string): void {
  const queryClient = useQueryClient();
  useStreamSubscription(StreamKind.RuleEvent, symbolId, () => {
    queryClient.invalidateQueries({ queryKey: RULES_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: STATE_QUERY_KEY });
  });
}
