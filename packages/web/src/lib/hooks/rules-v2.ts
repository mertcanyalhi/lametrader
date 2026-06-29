import type { RulesV2 } from '@lametrader/core';
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiFetch } from '../api-fetch.js';

/** Stable root for every v2-rules-related query key. */
export const RULES_V2_QUERY_KEY = ['rules-v2'] as const;

/** Stable key for the v2-rule-list query, parameterized by filters. */
export function rulesV2ListKey(
  filters: { profileId?: string; symbolId?: string; enabled?: boolean } = {},
) {
  return [...RULES_V2_QUERY_KEY, 'list', filters] as const;
}

/** Stable key for one v2 rule's detail query. */
export function ruleV2Key(id: string) {
  return [...RULES_V2_QUERY_KEY, 'detail', id] as const;
}

/** Stable key for one v2 rule's events query. */
export function ruleV2EventsKey(id: string, options: { limit?: number; before?: number } = {}) {
  return [...RULES_V2_QUERY_KEY, 'events', id, options] as const;
}

/**
 * The body the v2 `POST /v2/rules` / `PATCH /v2/rules/:id` accept.
 *
 * Same shape as the persisted {@link RulesV2.Rule} minus server-generated
 * identity / timestamps; the controller (#395) re-validates this against the
 * boundary schema before persisting.
 */
export type RuleV2Input = Omit<RulesV2.Rule, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Filter set for `GET /v2/rules`.
 *
 * Every filter is optional and independent; the server combines them with AND.
 */
export interface RulesV2ListFilters {
  /** Restrict to a single profile. */
  profileId?: string;
  /** Restrict to rules whose scope mentions this symbol. */
  symbolId?: string;
  /** Restrict to enabled (`true`) or disabled (`false`) rules. */
  enabled?: boolean;
}

/**
 * List v2 rules (`GET /v2/rules?profileId=&symbolId=&enabled=`).
 *
 * Every filter is optional and independent; the server combines them with AND.
 */
export function useRulesV2(
  filters: RulesV2ListFilters = {},
): UseQueryResult<RulesV2.Rule[], Error> {
  const search = new URLSearchParams();
  if (filters.profileId !== undefined) search.set('profileId', filters.profileId);
  if (filters.symbolId !== undefined) search.set('symbolId', filters.symbolId);
  if (filters.enabled !== undefined) search.set('enabled', String(filters.enabled));
  const qs = search.toString();
  return useQuery({
    queryKey: rulesV2ListKey(filters),
    queryFn: () => apiFetch<RulesV2.Rule[]>(qs ? `/v2/rules?${qs}` : '/v2/rules'),
  });
}

/** Fetch one v2 rule by id (`GET /v2/rules/:id`). */
export function useRuleV2(id: string): UseQueryResult<RulesV2.Rule, Error> {
  return useQuery({
    queryKey: ruleV2Key(id),
    queryFn: () => apiFetch<RulesV2.Rule>(`/v2/rules/${encodeURIComponent(id)}`),
  });
}

/**
 * Create a v2 rule (`POST /v2/rules`).
 *
 * Invalidates every v2-rules query on success so the list refetches.
 */
export function useCreateRuleV2(): UseMutationResult<RulesV2.Rule, Error, RuleV2Input> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RuleV2Input) =>
      apiFetch<RulesV2.Rule>('/v2/rules', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RULES_V2_QUERY_KEY }),
  });
}

/** Body the {@link usePatchRuleV2} mutation takes — id + the partial patch. */
export interface PatchRuleV2Input {
  /** The rule id to patch. */
  id: string;
  /** The partial body; the server merges it with the persisted rule and re-validates. */
  patch: Partial<RuleV2Input>;
}

/**
 * Patch a v2 rule (`PATCH /v2/rules/:id`).
 *
 * Same validation envelope as create — the controller re-validates the merged
 * result. Invalidates every v2-rules query on success.
 */
export function usePatchRuleV2(): UseMutationResult<RulesV2.Rule, Error, PatchRuleV2Input> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: PatchRuleV2Input) =>
      apiFetch<RulesV2.Rule>(`/v2/rules/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RULES_V2_QUERY_KEY }),
  });
}

/**
 * Delete a v2 rule (`DELETE /v2/rules/:id`).
 *
 * Invalidates every v2-rules query on success.
 */
export function useDeleteRuleV2(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/v2/rules/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RULES_V2_QUERY_KEY }),
  });
}

/**
 * Paginated read of one v2 rule's events log
 * (`GET /v2/rules/:id/events?limit=&before=`), newest-first.
 *
 * `limit` defaults to 50 server-side; `before` is a strict `<` cursor on `ts`
 * for "next page".
 */
export function useRuleV2Events(
  id: string,
  options: { limit?: number; before?: number } = {},
): UseQueryResult<RulesV2.RuleEventEntry[], Error> {
  const search = new URLSearchParams();
  if (options.limit !== undefined) search.set('limit', String(options.limit));
  if (options.before !== undefined) search.set('before', String(options.before));
  const qs = search.toString();
  const path = `/v2/rules/${encodeURIComponent(id)}/events${qs ? `?${qs}` : ''}`;
  return useQuery({
    queryKey: ruleV2EventsKey(id, options),
    queryFn: () => apiFetch<RulesV2.RuleEventEntry[]>(path),
  });
}
