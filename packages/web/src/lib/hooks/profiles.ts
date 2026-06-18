import type { Profile } from '@lametrader/core';
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiFetch } from '../api-fetch.js';
import type { ProfileFormValues } from '../profile-schema.js';

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

/**
 * Create a profile (`POST /profiles`) from the form fields. `scope` defaults to
 * `All` server-side. On success the profiles query is invalidated so the list
 * refetches with the new row.
 */
export function useCreateProfile(): UseMutationResult<Profile, Error, ProfileFormValues> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProfileFormValues) =>
      apiFetch<Profile>('/profiles', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PROFILES_QUERY_KEY }),
  });
}

/** The payload for editing a profile: its id plus the editable form fields. */
export interface UpdateProfileInput {
  /** Id of the profile to update. */
  id: string;
  /** The new `name` / `description` / `enabled`. */
  input: ProfileFormValues;
}

/**
 * Edit a profile (`PATCH /profiles/:id`) with only `name` / `description` /
 * `enabled`. PATCH (partial update) is used deliberately so the profile's
 * `scope` and attached `indicators` are preserved — a `PUT` would re-default an
 * omitted `scope` to `All`. On success the profiles query is invalidated.
 */
export function useUpdateProfile(): UseMutationResult<Profile, Error, UpdateProfileInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: UpdateProfileInput) =>
      apiFetch<Profile>(`/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PROFILES_QUERY_KEY }),
  });
}

/**
 * Delete a profile (`DELETE /profiles/:id`). On success the profiles query is
 * invalidated so the row disappears; the selector's reconciliation falls the
 * selection back to the first remaining enabled profile when the deleted one
 * was selected.
 */
export function useDeleteProfile(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/profiles/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PROFILES_QUERY_KEY }),
  });
}
