import { QueryClient } from '@tanstack/react-query';

/**
 * Build a fresh {@link QueryClient} with the app's default settings:
 * - Errors are not retried automatically (failures surface immediately so the
 *   UI can show them).
 * - Window refocus refetch is on (matches a trader's expectation of live data).
 *
 * Exposed as a factory so tests can construct an isolated client per render.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
