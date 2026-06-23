import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiFetch } from '../api-fetch.js';

/** Stable root for notification-related queries. */
export const NOTIFICATION_QUERY_KEY = ['notification'] as const;

/** Stable key for the telegram destinations list query. */
export const TELEGRAM_DESTINATIONS_KEY = [
  ...NOTIFICATION_QUERY_KEY,
  'telegram',
  'destinations',
] as const;

/** One destination entry returned by `GET /notification/telegram/destinations`. */
export interface TelegramDestinationSummary {
  /** The destination's human-readable name (the value the rule editor picks). */
  name: string;
  /** Target chat id — surfaced in the settings table. */
  chatId: string;
}

/** Body for `POST /notification/telegram/destinations`. */
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
 * (`GET /notification/telegram/destinations`). Drives the rule editor's
 * destination dropdown and the settings page's destinations table.
 */
export function useTelegramDestinations(): UseQueryResult<TelegramDestinationSummary[], Error> {
  return useQuery({
    queryKey: TELEGRAM_DESTINATIONS_KEY,
    queryFn: () => apiFetch<TelegramDestinationSummary[]>('/notification/telegram/destinations'),
  });
}

/**
 * Upsert a destination (`POST /notification/telegram/destinations`).
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
      apiFetch<TelegramDestinationSummary>('/notification/telegram/destinations', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TELEGRAM_DESTINATIONS_KEY }),
  });
}

/**
 * Delete a destination (`DELETE /notification/telegram/destinations/:name`).
 * Invalidates the list query on success.
 */
export function useDeleteTelegramDestination(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<void>(`/notification/telegram/destinations/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TELEGRAM_DESTINATIONS_KEY }),
  });
}
