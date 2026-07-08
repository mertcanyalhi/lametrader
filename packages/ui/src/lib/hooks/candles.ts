import { type Candle, type CandlePage, type Period, periodMillis } from '@lametrader/core';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formingBucketCandle } from '../aggregate-candles.js';
import { apiFetch } from '../api-fetch.js';
import { getLogger } from '../log.js';
import { type CandleEvent, StreamKind } from '../stream/stream-client.types.js';
import { useStreamSubscription } from '../stream/use-stream-subscription.js';

const log = getLogger('chart-paging');

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
      // ponytail: debug loop instrumentation, remove once diagnosed
      log.debug(
        {
          id,
          period,
          hasNextPage: query.hasNextPage,
          isFetchingNextPage: query.isFetchingNextPage,
          pages: query.data?.pages.length ?? 0,
          earliest: query.data?.pages.at(-1)?.candles[0]?.time,
        },
        'loadOlder called',
      );
      // Re-entrancy guard: no-op while an older window is already being fetched,
      // or once history is exhausted. The chart's viewport effects re-fire this
      // each render/candle; without the guard `fetchNextPage` (which defaults to
      // `cancelRefetch: true`) stacks/cancels requests and grows `candles`
      // unbounded — each merge sort then slower — until the tab hangs.
      if (query.isFetchingNextPage || !query.hasNextPage) return;
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
 * The latest live candle for one symbol AND period, or `null` before the first
 * matching frame.
 *
 * Unlike {@link useCandleStream} — which keeps the newest frame across *every*
 * polled period, so filtering it with {@link liveCandleForPeriod} yields `null`
 * whenever the last frame was for another period — this filters to `period`
 * *inside* the subscription, so a frame for a different period never clears the
 * charted period's bar. Consumers that need a stable "newest bar on screen"
 * (e.g. the chart's events window) must use this, not the collapsed stream.
 *
 * @param id - canonical symbol id to stream candles for.
 * @param period - the period the chart is rendering.
 */
export function useLatestCandle(id: string, period: Period): Candle | null {
  const [latest, setLatest] = useState<{ id: string; period: Period; candle: Candle } | null>(null);

  useStreamSubscription(StreamKind.Candle, id, (event) => {
    const candle = liveCandleForPeriod(event, period);
    if (candle) setLatest({ id, period, candle });
  });

  return latest?.id === id && latest.period === period ? latest.candle : null;
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

/**
 * Fetch every stored candle for one symbol+period in the half-open window
 * `[from, to)`, walking the keyset cursor forward until the range is exhausted.
 *
 * The `/symbols/:id/candles` endpoint paginates forward by `nextCursor`, so a
 * window wider than one page (`CHART_CANDLE_LIMIT` bars) is assembled here by
 * following the cursor. Used to catch a reattaching backtest chart up over REST:
 * the elapsed run-period candles are read from the candle store rather than
 * replayed through the socket. Returns candles ascending by `time`.
 *
 * @param id - canonical symbol id.
 * @param period - candle period to read.
 * @param from - inclusive lower bound, epoch ms.
 * @param to - exclusive upper bound, epoch ms.
 */
export async function fetchRangeCandles(
  id: string,
  period: Period,
  from: number,
  to: number,
): Promise<Candle[]> {
  const candles: Candle[] = [];
  let cursor: number | null = from;
  while (cursor !== null && cursor < to) {
    const page: CandlePage = await apiFetch<CandlePage>(
      `/symbols/${id}/candles?period=${period}&from=${cursor}&to=${to}&limit=${CHART_CANDLE_LIMIT}`,
    );
    candles.push(...page.candles);
    cursor = page.nextCursor;
  }
  return candles;
}

/**
 * Synthesize the **forming** (latest) bar of a larger `targetPeriod` by folding a
 * smaller period's candles in the current larger bucket — for a symbol the backend
 * never backfilled on `targetPeriod` (no roll-up, so it has no native bar of its
 * own) while a smaller period streams live. Only the forming bar is synthesized;
 * historical larger-period bars stay empty until backfilled.
 *
 * B2 data path: on mount (per `id` / `smallerPeriod` / `targetPeriod`) the current
 * bucket is seeded over REST from the smaller period, so the bar's open/high/low
 * are correct even when the chart opens mid-bucket; then each live smaller-period
 * stream frame is folded in. The bar is computed by {@link formingBucketCandle}.
 *
 * Returns `null` when disabled — `smallerPeriod` is `null`, or equals
 * `targetPeriod`. That is the normal case (the chart shows its own candles and
 * needs no synthesis), so `useSyntheticFormingBar` is inert and issues no fetch.
 *
 * The returned reference is stable while the bar's fields are unchanged, so a
 * consumer keying an effect on it (the chart's `formingBar` apply) re-runs only
 * on a real change, not on every buffer mutation.
 *
 * @param id - canonical symbol id.
 * @param smallerPeriod - the streamed smaller period to fold up, or `null` to disable.
 * @param targetPeriod - the larger period to synthesize the forming bar for.
 */
export function useSyntheticFormingBar({
  id,
  smallerPeriod,
  targetPeriod,
}: {
  id: string;
  smallerPeriod: Period | null;
  targetPeriod: Period;
}): Candle | null {
  const enabled = smallerPeriod !== null && smallerPeriod !== targetPeriod;
  // Ties the seed query, the stream buffer, and the reset together; `null` disables.
  const key = enabled ? `${id}:${smallerPeriod}:${targetPeriod}` : null;

  // Smaller-period candles in play, keyed by open time: seeded via REST, then
  // extended by the live stream. Cleared whenever the (id, periods) tuple changes.
  const [buffer, setBuffer] = useState<Map<number, Candle>>(() => new Map());
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is a signal-only dep — a change (new symbol/period) must clear the buffer so a stale bucket can't bleed across.
  useEffect(() => {
    setBuffer(new Map());
  }, [key]);

  // Seed the current bucket once per key. `bucketStart` is the floor of `now` to
  // the target boundary; later buckets are filled entirely by live stream frames.
  const seed = useQuery({
    queryKey: ['forming-seed', key],
    queryFn: () => {
      const bucketMs = periodMillis(targetPeriod);
      const now = Date.now();
      const bucketStart = Math.floor(now / bucketMs) * bucketMs;
      return fetchRangeCandles(id, smallerPeriod as Period, bucketStart, now + 1);
    },
    enabled,
  });

  const seeded = seed.data;
  useEffect(() => {
    if (!seeded) return;
    setBuffer((prev) => {
      const next = new Map(prev);
      for (const candle of seeded) next.set(candle.time, candle);
      return next;
    });
  }, [seeded]);

  useStreamSubscription(
    StreamKind.Candle,
    enabled ? id : null,
    (event) => {
      if (event.period !== smallerPeriod) return;
      setBuffer((prev) => {
        const next = new Map(prev);
        next.set(event.candle.time, event.candle);
        return next;
      });
    },
    [key],
  );

  const bar = useMemo(() => {
    if (!enabled) return null;
    const ascending = [...buffer.values()].sort((a, b) => a.time - b.time);
    return formingBucketCandle(ascending, targetPeriod);
  }, [enabled, buffer, targetPeriod]);

  // Hold the last reference until the bar's fields actually change, so a redundant
  // buffer mutation (e.g. a stream frame that leaves the current bucket unchanged)
  // doesn't hand the chart a fresh object and re-apply an identical `update`.
  const lastBar = useRef<Candle | null>(null);
  if (!sameCandle(lastBar.current, bar)) lastBar.current = bar;
  return lastBar.current;
}

/**
 * Whether two candles carry identical rendered fields (or are both `null`) —
 * `time` + OHLC + volume, the fields the chart actually draws. The aggregated
 * bar is rebuilt fresh each fold, so reference identity alone can't tell an
 * unchanged bar from a changed one; an explicit field compare avoids depending
 * on object key order (and pulls in no deep-equal dependency).
 */
function sameCandle(a: Candle | null, b: Candle | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    a.time === b.time &&
    a.open === b.open &&
    a.high === b.high &&
    a.low === b.low &&
    a.close === b.close &&
    ('volume' in a ? a.volume : 0) === ('volume' in b ? b.volume : 0)
  );
}

/**
 * The candle series the backtesting **setup** (idle) chart renders for a selected
 * symbol + period, as a plain `Candle[]` for {@link usePagedCandles}'s normal
 * consumer — so `CandleChart` stays a dumb renderer with no aggregation-aware prop.
 *
 * Normally this is just the period's own paged candles, returned **unchanged**
 * (zero behavior change for a period that has its own data). But when the selected
 * (larger) period has no native candles and the symbol streams a strictly smaller
 * period, the series becomes a single **synthesized forming bar** — the current
 * larger bucket aggregated from the smaller period via {@link useSyntheticFormingBar}
 * — so the idle chart shows the live latest bar instead of an empty canvas. Only
 * the forming bar is synthesized; historical larger-period bars stay empty.
 *
 * @param id - canonical symbol id.
 * @param period - the selected (charted) period.
 * @param smallerPeriod - the symbol's smallest watched period to fold up; ignored
 *   when it equals `period` (then the period is its own smallest, nothing to fold).
 */
export function useBacktestSetupCandles({
  id,
  period,
  smallerPeriod,
}: {
  id: string;
  period: Period;
  smallerPeriod: Period | null;
}): PagedCandles {
  const feed = usePagedCandles({ id, period });
  // Synthesize only once the native feed has settled empty and a smaller period
  // is available to fold up — otherwise disabled (passthrough, no fetch/stream).
  const canSynthesize = !feed.isPending && feed.candles.length === 0;
  const forming = useSyntheticFormingBar({
    id,
    smallerPeriod: canSynthesize ? smallerPeriod : null,
    targetPeriod: period,
  });
  const candles = useMemo(
    () => (feed.candles.length > 0 ? feed.candles : forming ? [forming] : []),
    [feed.candles, forming],
  );
  return { ...feed, candles };
}
