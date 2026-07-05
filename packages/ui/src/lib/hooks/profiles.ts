import type { Profile, ProfileFields } from '@lametrader/core';
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiFetch } from '../api-fetch.js';

/**
 * Stable key for the profile-list query. Mutations below invalidate it so a
 * successful create / edit / delete refetches the list.
 */
export const PROFILES_QUERY_KEY = ['profiles'] as const;

/** Fetch every profile (`GET /profiles`). */
export function useProfiles(): UseQueryResult<Profile[], Error> {
  return useQuery({
    queryKey: PROFILES_QUERY_KEY,
    queryFn: () => apiFetch<Profile[]>('/profiles'),
  });
}

/**
 * Create a new profile (`POST /profiles`). On success the list query is
 * invalidated so the picker refetches.
 */
export function useCreateProfile(): UseMutationResult<Profile, Error, ProfileFields> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fields: ProfileFields) =>
      apiFetch<Profile>('/profiles', { method: 'POST', body: JSON.stringify(fields) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PROFILES_QUERY_KEY }),
  });
}

/** The patchable subset of a profile from the picker form: name/description/enabled. */
export interface UpdateProfileInput {
  /** The profile id to patch. */
  id: string;
  /** The patch body — only the form-editable fields, so `scope` + `indicators` are preserved server-side. */
  patch: Pick<ProfileFields, 'name' | 'description' | 'enabled'>;
}

/**
 * Patch a profile's editable fields (`PATCH /profiles/:id`). The picker form
 * edits name/description/enabled; using `PATCH` lets the server preserve `scope`
 * and `indicators` without the form having to know about them.
 */
export function useUpdateProfile(): UseMutationResult<Profile, Error, UpdateProfileInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateProfileInput) =>
      apiFetch<Profile>(`/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PROFILES_QUERY_KEY }),
  });
}

/**
 * Delete a profile (`DELETE /profiles/:id`). On success the list query is
 * invalidated so the picker refetches; the picker is also responsible for
 * falling the global selection back to the first remaining enabled profile.
 */
export function useDeleteProfile(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/profiles/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PROFILES_QUERY_KEY }),
  });
}
