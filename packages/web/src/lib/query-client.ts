import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { getLogger } from './log.js';

/**
 * Scoped logger for the query layer. Every failed query / mutation that flows
 * through the cache is recorded here with its key, so debugging "why didn't
 * this list refresh?" doesn't depend on timestamp-correlating with the lower
 * `api-fetch` logs (`api-fetch` already logs HTTP-level details — this layer
 * adds the query-key context).
 */
const log = getLogger('query-client');

/**
 * Build a fresh {@link QueryClient} with the app's default settings:
 * - Errors are not retried automatically (failures surface immediately so the
 *   UI can show them).
 * - Window refocus refetch is on (matches a trader's expectation of live data).
 * - Every failed query / mutation is logged via Pino so failures aren't lost
 *   between the network panel and a transient UI toast.
 *
 * Exposed as a factory so tests can construct an isolated client per render.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        log.warn({ queryKey: query.queryKey, err: error }, 'query failed');
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        log.warn({ mutationKey: mutation.options.mutationKey, err: error }, 'mutation failed');
      },
    }),
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
