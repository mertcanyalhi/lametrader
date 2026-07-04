import { type Candle, type CandlePage, type Period, periodMillis } from '@lametrader/core';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api-fetch.js';
import { type CandleEvent, StreamKind } from '../stream/stream-client.types.js';
import { useStreamSubscription } from '../stream/use-stream-subscription.js';

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

  // Re-anchor target (issue #70): when the window at `now` is empty but the
  // symbol has older stored history, jump the anchor to just past the latest
  // stored bar and refetch. Tagged with the symbol/period it belongs to so a
  // switch to another symbol/period falls back to `now` with no reset effect.
  const [anchor, setAnchor] = useState<{ key: string; to: number } | null>(null);
  const target = `${id}:${period}`;
  const anchoredTo = anchor?.key === target ? anchor.to : null;
  const to = anchoredTo ?? now;

  const query = useInfiniteQuery({
    queryKey: ['candles', id, period, anchoredTo],
    queryFn: ({ pageParam }) =>
      apiFetch<CandlePage>(
        `/symbols/${id}/candles?period=${period}&from=${pageParam.from}&to=${pageParam.to}&limit=${CHART_CANDLE_LIMIT}`,
      ),
    initialPageParam: { from: to - span, to } as CandleWindow,
    getNextPageParam: (lastPage, _allPages, lastParam): CandleWindow | undefined =>
      lastPage.candles.length === 0
        ? undefined
        : { from: lastParam.from - span, to: lastParam.from },
  });

  // Empty at `now` but history exists earlier → re-anchor once and refetch.
  // `+ 1` because the read window is `[from, to)` — anchoring `to` at
  // exactly latestTime would exclude that very bar.
  const firstPage = query.data?.pages[0];
  const needsReanchor =
    anchoredTo === null && firstPage?.candles.length === 0 && firstPage.latestTime != null;
  useEffect(() => {
    if (needsReanchor && firstPage?.latestTime != null) {
      setAnchor({ key: target, to: firstPage.latestTime + 1 });
    }
  }, [needsReanchor, firstPage, target]);

  // The infinite query freezes its newest page's `to` at the first open, so bars
  // that form while the chart is unmounted are never fetched when it reopens —
  // leaving a gap on screen-switch. A plain query for the recent window refetches
  // on mount/focus with a fresh `now` (a `useQuery` re-reads its queryFn each
  // refetch, unlike infinite-query page params), catching up to the present; its
  // bars are merged over the paged history. Best-effort: a failure just leaves the
  // paged data, so its error/loading state doesn't gate the chart.
  const latest = useQuery({
    queryKey: ['candles', id, period, 'latest'],
    queryFn: () =>
      apiFetch<CandlePage>(
        `/symbols/${id}/candles?period=${period}&from=${now - span}&to=${now}&limit=${CHART_CANDLE_LIMIT}`,
      ),
  });

  // Pages arrive newest-window-first; reversing then flattening yields one series
  // ascending by time, then the catch-up window is merged over it (deduped by
  // time, newest data winning). Memoized on the query data so the array identity
  // is stable across re-renders that don't change it — consumers (the chart) key
  // effects on this reference, and a fresh array each render would re-run them
  // (and clobber live updates).
  const pages = query.data?.pages;
  const latestCandles = latest.data?.candles;
  const candles = useMemo(
    () =>
      mergeCandlesByTime(
        (pages ?? [])
          .slice()
          .reverse()
          .flatMap((page) => page.candles),
        latestCandles ?? [],
      ),
    [pages, latestCandles],
  );

  return {
    candles,
    loadOlder: () => {
      query.fetchNextPage();
    },
    hasMore: query.hasNextPage,
    // Keep "loading" through the re-anchor handoff so the empty state never flashes.
    isPending: query.isPending || needsReanchor,
    isFetchingOlder: query.isFetchingNextPage,
    isError: query.isError,
    error: query.error,
  };
}

/**
 * Subscribe to a symbol's live candle feed over the shared `/stream` client and
 * return the latest candle event, or `null` before the first frame. The feed
 * spans every period the symbol is polled on — callers filter to the period
 * they chart via {@link liveCandleForPeriod}. The latest event is stored with
 * the id it arrived for, so changing `id` reads back `null` until the new
 * symbol's first frame; the subscription is torn down on unmount.
 *
 * @param id - canonical symbol id to stream candles for.
 */
export function useCandleStream(id: string): CandleEvent | null {
  const [latest, setLatest] = useState<{ id: string; event: CandleEvent } | null>(null);

  useStreamSubscription(StreamKind.Candle, id, (event) => setLatest({ id, event }));

  return latest?.id === id ? latest.event : null;
}

/**
 * The candle from a live {@link CandleEvent} when it belongs to `period`, else
 * `null`. The candle feed carries every polled period for a symbol; the chart
 * renders one, so it keeps only the matching event's bar (and `null` when there
 * is no event yet or it is for another period).
 *
 * @param event - the latest live candle event, or `null`.
 * @param period - the period the chart is rendering.
 */
export function liveCandleForPeriod(event: CandleEvent | null, period: Period): Candle | null {
  return event && event.period === period ? event.candle : null;
}

/**
 * Merge two time-ascending candle series into one, deduped by `time`, with the
 * `latest` series winning on overlap (it carries the fresher reading). Used to
 * fold the catch-up recent window over the paged history so reopening the chart
 * fills any gap. The result is sorted ascending by `time`.
 *
 * @param paged - the backward-paged history, ascending by time.
 * @param latest - the recent catch-up window, ascending by time.
 */
export function mergeCandlesByTime(paged: Candle[], latest: Candle[]): Candle[] {
  if (latest.length === 0) return paged;
  const byTime = new Map<number, Candle>();
  for (const candle of paged) byTime.set(candle.time, candle);
  for (const candle of latest) byTime.set(candle.time, candle);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}
