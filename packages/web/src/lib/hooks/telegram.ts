import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-fetch.js';

/** Stable root for telegram-related queries. */
export const TELEGRAM_QUERY_KEY = ['telegram'] as const;

/** One destination entry returned by `GET /telegram/destinations`. */
export interface TelegramDestinationSummary {
  /** The destination's human-readable name (the value the rule editor picks). */
  name: string;
}

/**
 * List the API's configured Telegram destination names
 * (`GET /telegram/destinations`). Drives the rule editor's destination
 * dropdown for `NotifyTelegram` actions.
 */
export function useTelegramDestinations(): UseQueryResult<TelegramDestinationSummary[], Error> {
  return useQuery({
    queryKey: TELEGRAM_QUERY_KEY,
    queryFn: () => apiFetch<TelegramDestinationSummary[]>('/telegram/destinations'),
  });
}
