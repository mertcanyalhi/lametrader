import type { Profile } from '@lametrader/core';
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-fetch.js';

/**
 * Stable key for the profiles list query. Iteration 2's create/edit/delete
 * mutations will invalidate it so the selector refetches after a change.
 */
export const PROFILES_QUERY_KEY = ['profiles'] as const;

/**
 * Fetch all profiles (`GET /profiles`). The bottom-bar profile selector binds
 * to this hook; the selected id (client state) is reconciled against this list
 * by `resolveSelectedProfileId`.
 */
export function useProfiles(): UseQueryResult<Profile[], Error> {
  return useQuery({
    queryKey: PROFILES_QUERY_KEY,
    queryFn: () => apiFetch<Profile[]>('/profiles'),
  });
}
