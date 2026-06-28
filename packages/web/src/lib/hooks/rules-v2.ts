import type { RulesV2 } from '@lametrader/core';
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiFetch } from '../api-fetch.js';

/** Stable root for every v2-rules query key. */
export const RULES_V2_QUERY_KEY = ['rules-v2'] as const;

/** Stable key for the v2-rule-list query, parameterized by the filters. */
export function rulesV2ListKey(
  filters: { profileId?: string; symbolId?: string; enabled?: boolean } = {},
) {
  return [...RULES_V2_QUERY_KEY, 'list', filters] as const;
}

/** Stable key for a single-v2-rule query. */
export function ruleV2Key(id: string) {
  return [...RULES_V2_QUERY_KEY, 'detail', id] as const;
}

/** Body the v2 API's `POST /v2/rules` accepts — client-controllable subset of {@link RulesV2.Rule}. */
export type RuleV2Input = Omit<RulesV2.Rule, 'id' | 'createdAt' | 'updatedAt'>;

/** Body the v2 API's `PATCH /v2/rules/:id` accepts — every field optional (merge semantics). */
export type RuleV2Patch = Partial<RuleV2Input>;

/**
 * List v2 rules (`GET /v2/rules?profileId=&symbolId=&enabled=`). All filters
 * are optional and combinable; the list reflects the server's order.
 */
export function useRulesV2(
  filters: { profileId?: string; symbolId?: string; enabled?: boolean } = {},
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
 * Create a v2 rule (`POST /v2/rules`). Invalidates every v2-rules query on
 * success so the list page refetches.
 */
export function useCreateRuleV2(): UseMutationResult<RulesV2.Rule, Error, RuleV2Input> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RuleV2Input) =>
      apiFetch<RulesV2.Rule>('/v2/rules', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RULES_V2_QUERY_KEY }),
  });
}

/** Body the {@link useReplaceRuleV2} mutation takes — id + the patch payload. */
export interface ReplaceRuleV2Input {
  /** The v2 rule id to update. */
  id: string;
  /** The patch body — merged server-side, then re-validated. */
  patch: RuleV2Patch;
}

/**
 * Update a v2 rule (`PATCH /v2/rules/:id`) — partial merge semantics. On
 * success invalidates every v2-rules query so list and detail views refetch.
 */
export function useReplaceRuleV2(): UseMutationResult<RulesV2.Rule, Error, ReplaceRuleV2Input> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: ReplaceRuleV2Input) =>
      apiFetch<RulesV2.Rule>(`/v2/rules/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RULES_V2_QUERY_KEY }),
  });
}

/**
 * Delete a v2 rule (`DELETE /v2/rules/:id`). Performs an optimistic removal
 * from every cached v2-rules list so the row disappears before the server
 * round-trip; rolls back on error and invalidates in `onSettled` to reconcile.
 */
export function useDeleteRuleV2(): UseMutationResult<
  void,
  Error,
  string,
  { snapshots: Array<[readonly unknown[], unknown]> }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/v2/rules/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: RULES_V2_QUERY_KEY });
      const snapshots = queryClient.getQueriesData({ queryKey: RULES_V2_QUERY_KEY });
      queryClient.setQueriesData<RulesV2.Rule[] | RulesV2.Rule>(
        { queryKey: RULES_V2_QUERY_KEY },
        (current) => {
          if (Array.isArray(current)) return current.filter((rule) => rule.id !== id);
          return current;
        },
      );
      return { snapshots };
    },
    onError: (_error, _id, context) => {
      if (!context) return;
      for (const [key, value] of context.snapshots) queryClient.setQueryData(key, value);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: RULES_V2_QUERY_KEY }),
  });
}
