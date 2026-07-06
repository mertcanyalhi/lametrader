import type {
  NotificationChannel,
  NotificationConfigSummary,
  NotificationConfigView,
} from '@lametrader/core';
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiFetch } from '../api-fetch.js';

/** Stable root for notification-config queries (list + individual). */
export const CONFIG_NOTIFICATIONS_QUERY_KEY = ['config', 'notifications'] as const;

/** The query key for one config's detail view. */
export function notificationQueryKey(
  id: string,
): readonly [...typeof CONFIG_NOTIFICATIONS_QUERY_KEY, string] {
  return [...CONFIG_NOTIFICATIONS_QUERY_KEY, id];
}

/** Body for `POST /config/notifications`. */
export interface CreateNotificationInput {
  /** The channel discriminator (immutable once created). */
  notificationType: NotificationChannel;
  /** Unique alias. */
  name: string;
  /** Bot API token — write-only; the server never reads it back. */
  botToken: string;
  /** Target chat id. */
  chatId: string;
}

/** Body for `PATCH /config/notifications/:id`; every field optional. */
export interface UpdateNotificationInput {
  /** New name. */
  name?: string;
  /** New bot token; omit to keep the stored one. */
  botToken?: string;
  /** New chat id. */
  chatId?: string;
}

/**
 * List the configured notifications (`GET /config/notifications`).
 * Drives the settings table and the rule editor's destination dropdown.
 */
export function useNotifications(): UseQueryResult<NotificationConfigSummary[], Error> {
  return useQuery({
    queryKey: CONFIG_NOTIFICATIONS_QUERY_KEY,
    queryFn: () => apiFetch<NotificationConfigSummary[]>('/config/notifications'),
  });
}

/**
 * Fetch one config's view (`GET /config/notifications/:id`) — the edit form
 * prefills from it. Disabled until `id` is set.
 */
export function useNotification(id: string | null): UseQueryResult<NotificationConfigView, Error> {
  return useQuery({
    queryKey: notificationQueryKey(id ?? ''),
    queryFn: () =>
      apiFetch<NotificationConfigView>(`/config/notifications/${encodeURIComponent(id ?? '')}`),
    enabled: id !== null,
  });
}

/**
 * Create a config (`POST /config/notifications`).
 * Invalidates the notifications queries on success.
 */
export function useCreateNotification(): UseMutationResult<
  NotificationConfigView,
  Error,
  CreateNotificationInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateNotificationInput) =>
      apiFetch<NotificationConfigView>('/config/notifications', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CONFIG_NOTIFICATIONS_QUERY_KEY }),
  });
}

/**
 * Update a config (`PATCH /config/notifications/:id`).
 * Invalidates the notifications queries on success.
 */
export function useUpdateNotification(): UseMutationResult<
  NotificationConfigView,
  Error,
  { id: string; patch: UpdateNotificationInput }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateNotificationInput }) =>
      apiFetch<NotificationConfigView>(`/config/notifications/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CONFIG_NOTIFICATIONS_QUERY_KEY }),
  });
}

/**
 * Delete a config (`DELETE /config/notifications/:id`).
 * Invalidates the notifications queries on success.
 */
export function useDeleteNotification(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/config/notifications/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CONFIG_NOTIFICATIONS_QUERY_KEY }),
  });
}
