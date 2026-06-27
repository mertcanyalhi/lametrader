import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiFetch } from '../api-fetch.js';

/** Stable root for config-notifications-related queries. */
export const CONFIG_NOTIFICATIONS_QUERY_KEY = ['config', 'notifications'] as const;

/** Stable key for the telegram destinations list query. */
export const TELEGRAM_DESTINATIONS_KEY = [...CONFIG_NOTIFICATIONS_QUERY_KEY, 'telegram'] as const;

/** One destination entry returned by `GET /config/notifications/telegram`. */
export interface TelegramDestinationSummary {
  /** The destination's human-readable name (the value the rule editor picks). */
  name: string;
  /** Target chat id — surfaced in the settings table. */
  chatId: string;
}

/** Body for `POST /config/notifications/telegram`. */
export interface TelegramDestinationInput {
  /** Destination name (unique key). */
  name: string;
  /** Bot API token — write-only; the server never reads it back. */
  botToken: string;
  /** Target chat id. */
  chatId: string;
}

/**
 * List the API's configured Telegram destinations
 * (`GET /config/notifications/telegram`). Drives the rule editor's
 * destination dropdown and the settings page's destinations table.
 */
export function useTelegramDestinations(): UseQueryResult<TelegramDestinationSummary[], Error> {
  return useQuery({
    queryKey: TELEGRAM_DESTINATIONS_KEY,
    queryFn: () => apiFetch<TelegramDestinationSummary[]>('/config/notifications/telegram'),
  });
}

/**
 * Upsert a destination (`POST /config/notifications/telegram`).
 * Invalidates the list query on success so the settings table re-renders.
 */
export function useUpsertTelegramDestination(): UseMutationResult<
  TelegramDestinationSummary,
  Error,
  TelegramDestinationInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TelegramDestinationInput) =>
      apiFetch<TelegramDestinationSummary>('/config/notifications/telegram', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TELEGRAM_DESTINATIONS_KEY }),
  });
}

/**
 * Delete a destination (`DELETE /config/notifications/telegram/:name`).
 * Invalidates the list query on success.
 */
export function useDeleteTelegramDestination(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<void>(`/config/notifications/telegram/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TELEGRAM_DESTINATIONS_KEY }),
  });
}
