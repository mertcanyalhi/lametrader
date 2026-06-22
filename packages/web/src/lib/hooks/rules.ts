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
 * Delete a rule (`DELETE /rules/:id`). On success invalidates every rules
 * query so the list refetches.
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
