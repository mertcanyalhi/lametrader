import type { Rule, RuleEventEntry } from '@lametrader/core';
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiFetch } from '../api-fetch.js';

/** Stable root for every rules-related query key. */
export const RULES_QUERY_KEY = ['rules'] as const;

/** Stable key for the rule-list query, parameterized by the filters. */
export function rulesListKey(filters: { profileId?: string; symbolId?: string } = {}) {
  return [...RULES_QUERY_KEY, 'list', filters] as const;
}

/** Stable key for a single-rule query. */
export function ruleKey(id: string) {
  return [...RULES_QUERY_KEY, 'detail', id] as const;
}

/** Stable key for a rule's embedded-events query. */
export function ruleEventsKey(id: string, options: { limit?: number; before?: number } = {}) {
  return [...RULES_QUERY_KEY, 'events', id, options] as const;
}

/** Stable key for a symbol's embedded rule-events query. */
export function symbolRuleEventsKey(
  symbolId: string,
  options: { limit?: number; before?: number } = {},
) {
  return [...RULES_QUERY_KEY, 'symbolEvents', symbolId, options] as const;
}

/** Body the API's `POST /rules` and `PUT /rules/:id` both accept. */
export type RuleInput = Omit<Rule, 'id' | 'events' | 'history' | 'createdAt' | 'updatedAt'>;

/**
 * List rules (`GET /rules?profileId=&symbolId=`). Both filters are optional
 * and combinable; the list always reflects the server's order (the API
 * exposes the `PUT /rules/order` route to renumber explicitly).
 */
export function useRules(
  filters: { profileId?: string; symbolId?: string } = {},
): UseQueryResult<Rule[], Error> {
  const search = new URLSearchParams();
  if (filters.profileId !== undefined) search.set('profileId', filters.profileId);
  if (filters.symbolId !== undefined) search.set('symbolId', filters.symbolId);
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
 * Create a rule (`POST /rules`). Invalidates every rules query on success
 * so the list page refetches.
 */
export function useCreateRule(): UseMutationResult<Rule, Error, RuleInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RuleInput) =>
      apiFetch<Rule>('/rules', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RULES_QUERY_KEY }),
  });
}

/** Body the {@link useReplaceRule} mutation takes — id + the full `RuleInput`. */
export interface ReplaceRuleInput {
  /** The rule id to replace. */
  id: string;
  /** The full replacement payload (no embedded events/history/id/timestamps). */
  input: RuleInput;
}

/**
 * Replace a rule's mutable fields (`PUT /rules/:id`). On success invalidates
 * every rules query so list and detail views refetch.
 */
export function useReplaceRule(): UseMutationResult<Rule, Error, ReplaceRuleInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: ReplaceRuleInput) =>
      apiFetch<Rule>(`/rules/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RULES_QUERY_KEY }),
  });
}

/** Body the {@link usePatchRule} mutation takes — id + the partial patch. */
export interface PatchRuleInput {
  /** The rule id to patch. */
  id: string;
  /** The partial body — currently only `enabled` is supported by the API. */
  patch: { enabled?: boolean };
}

/**
 * Patch a rule's mutable subset (`PATCH /rules/:id`). The only currently
 * patchable field is `enabled` (toggled by the list page's enable/disable
 * action; appends an `Enabled` / `Disabled` history entry server-side).
 *
 * Performs an optimistic write across every cached rule list / detail so the
 * UI flips before the server round-trip; rolls back to the snapshot on error
 * and finally refetches to reconcile with the server.
 */
export function usePatchRule(): UseMutationResult<
  Rule,
  Error,
  PatchRuleInput,
  { snapshots: Array<[readonly unknown[], unknown]> }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: PatchRuleInput) =>
      apiFetch<Rule>(`/rules/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: RULES_QUERY_KEY });
      const snapshots = queryClient.getQueriesData({ queryKey: RULES_QUERY_KEY });
      queryClient.setQueriesData<Rule[] | Rule>({ queryKey: RULES_QUERY_KEY }, (current) => {
        if (Array.isArray(current))
          return current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule));
        if (current && typeof current === 'object' && 'id' in current && current.id === id)
          return { ...current, ...patch };
        return current;
      });
      return { snapshots };
    },
    onError: (_error, _variables, context) => {
      if (!context) return;
      for (const [key, value] of context.snapshots) queryClient.setQueryData(key, value);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: RULES_QUERY_KEY }),
  });
}

/**
 * Delete a rule (`DELETE /rules/:id`). Performs an optimistic removal from
 * every cached rule list so the row disappears before the server round-trip;
 * rolls back to the snapshot on error and invalidates in `onSettled` to
 * reconcile with the server.
 */
export function useDeleteRule(): UseMutationResult<
  void,
  Error,
  string,
  { snapshots: Array<[readonly unknown[], unknown]> }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/rules/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: RULES_QUERY_KEY });
      const snapshots = queryClient.getQueriesData({ queryKey: RULES_QUERY_KEY });
      queryClient.setQueriesData<Rule[] | Rule>({ queryKey: RULES_QUERY_KEY }, (current) => {
        if (Array.isArray(current)) return current.filter((rule) => rule.id !== id);
        return current;
      });
      return { snapshots };
    },
    onError: (_error, _id, context) => {
      if (!context) return;
      for (const [key, value] of context.snapshots) queryClient.setQueryData(key, value);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: RULES_QUERY_KEY }),
  });
}

/**
 * Bulk-renumber the rule ordering (`PUT /rules/order`). The body's `ids`
 * become the new 1-based `order`; on success invalidates every rules query.
 */
export function useReorderRules(): UseMutationResult<Rule[], Error, string[]> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<Rule[]>('/rules/order', { method: 'PUT', body: JSON.stringify({ ids }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RULES_QUERY_KEY }),
  });
}

/**
 * Paginated read of a rule's embedded events (`GET /rules/:id/events`),
 * newest-first. `limit` defaults to 50 server-side; `before` is a strict
 * `<` cursor on `ts` for "next page".
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
 * Paginated read of a symbol's embedded rule events
 * (`GET /symbols/:id/rule-events`), newest-first — surfaces every rule
 * firing against the symbol regardless of which rule produced it. Same
 * pagination contract as {@link useRuleEvents} (`limit` default 50;
 * `before` is a strict `<` cursor on `ts`).
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
