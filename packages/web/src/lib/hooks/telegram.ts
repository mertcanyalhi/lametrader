import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-fetch.js';

/** Stable root for notification-related queries. */
export const NOTIFICATION_QUERY_KEY = ['notification'] as const;

/** One destination entry returned by `GET /notification/telegram/destinations`. */
export interface TelegramDestinationSummary {
  /** The destination's human-readable name (the value the rule editor picks). */
  name: string;
}

/**
 * List the API's configured Telegram destination names
 * (`GET /notification/telegram/destinations`). Drives the rule editor's
 * destination dropdown for `NotifyTelegram` actions.
 *
 * The `/notification` prefix is shared by every notifier adapter — future
 * adapters add their own hook alongside this one.
 */
export function useTelegramDestinations(): UseQueryResult<TelegramDestinationSummary[], Error> {
  return useQuery({
    queryKey: [...NOTIFICATION_QUERY_KEY, 'telegram', 'destinations'] as const,
    queryFn: () => apiFetch<TelegramDestinationSummary[]>('/notification/telegram/destinations'),
  });
}
