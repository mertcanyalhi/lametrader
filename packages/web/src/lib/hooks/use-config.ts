import type { Config } from '@lametrader/core';
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiFetch } from '../api-fetch.js';

/**
 * Stable key for the platform-config query — used by both the read hook and
 * the write hook's cache update.
 */
const CONFIG_QUERY_KEY = ['config'] as const;

/**
 * Fetch the persisted platform configuration (`GET /config`).
 *
 * The result is the canonical source for any UI binding `periods` /
 * `defaultPeriod`; pages should read it through this hook rather than
 * calling `apiFetch` directly.
 */
export function useConfig(): UseQueryResult<Config, Error> {
  return useQuery({
    queryKey: CONFIG_QUERY_KEY,
    queryFn: () => apiFetch<Config>('/config'),
  });
}

/**
 * Replace the persisted platform configuration (`PUT /config`).
 *
 * On success, the response payload is written straight into the `['config']`
 * cache so any subscribed component re-renders from the same value the server
 * just persisted (no follow-up `GET` round-trip).
 */
export function useUpdateConfig(): UseMutationResult<Config, Error, Config> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (next: Config) =>
      apiFetch<Config>('/config', { method: 'PUT', body: JSON.stringify(next) }),
    onSuccess: (saved) => {
      queryClient.setQueryData<Config>(CONFIG_QUERY_KEY, saved);
    },
  });
}
