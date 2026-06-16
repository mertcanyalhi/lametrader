import { type Candle, type CandlePage, type Period, periodMillis } from '@lametrader/core';
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-fetch.js';

/**
 * Bars per fetch window. The window is sized as `CHART_PAGE_BARS × periodMillis`
 * so it holds at most this many bars — comfortably under {@link CHART_CANDLE_LIMIT},
 * so the server returns the window whole (no mid-window truncation by `limit`).
 */
export const CHART_PAGE_BARS = 500;

/** The `limit` requested per window — headroom over {@link CHART_PAGE_BARS}. */
export const CHART_CANDLE_LIMIT = 1000;

/** One inclusive-from / exclusive-to time window fetched as a page. */
interface CandleWindow {
  from: number;
  to: number;
}

/**
 * The windowed candle feed the chart binds to. `candles` is the accumulated
 * series ascending by time; `loadOlder` extends it one window further back.
 */
export interface PagedCandles {
  /** Accumulated candles, ascending by `time`. */
  candles: Candle[];
  /** Fetch the next older window and prepend it. A no-op once `hasMore` is false. */
  loadOlder: () => void;
  /** Whether an older window may still hold candles. */
  hasMore: boolean;
  /** The initial window is still loading. */
  isPending: boolean;
  /** An older window is currently being fetched. */
  isFetchingOlder: boolean;
  /** The query failed. */
  isError: boolean;
  /** The failure, when `isError`. */
  error: Error | null;
}

/**
 * Load a symbol's historical candles for one period, newest window first, with
 * `loadOlder()` walking the window backward through time.
 *
 * The `/symbols/:id/candles` endpoint only paginates forward (ascending, cursor
 * toward newer bars), so this hook instead requests explicit `[from, to)` time
 * windows: the first anchored at `now`, each older one offset back by a full
 * window. Paging stops when an older window returns no candles — the start of
 * the contiguous backfilled history.
 */
export function usePagedCandles({ id, period }: { id: string; period: Period }): PagedCandles {
  const span = CHART_PAGE_BARS * periodMillis(period);
  const now = Date.now();

  const query = useInfiniteQuery({
    queryKey: ['candles', id, period],
    queryFn: ({ pageParam }) =>
      apiFetch<CandlePage>(
        `/symbols/${id}/candles?period=${period}&from=${pageParam.from}&to=${pageParam.to}&limit=${CHART_CANDLE_LIMIT}`,
      ),
    initialPageParam: { from: now - span, to: now } as CandleWindow,
    getNextPageParam: (lastPage, _allPages, lastParam): CandleWindow | undefined =>
      lastPage.candles.length === 0
        ? undefined
        : { from: lastParam.from - span, to: lastParam.from },
  });

  // Pages arrive newest-window-first; reversing then flattening yields one
  // series ascending by time (each page is already ascending internally).
  const candles = (query.data?.pages ?? [])
    .slice()
    .reverse()
    .flatMap((page) => page.candles);

  return {
    candles,
    loadOlder: () => {
      query.fetchNextPage();
    },
    hasMore: query.hasNextPage,
    isPending: query.isPending,
    isFetchingOlder: query.isFetchingNextPage,
    isError: query.isError,
    error: query.error,
  };
}
