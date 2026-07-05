import { type Candle, type CandleRepository, type Period, StateValueType } from '@lametrader/core';

import type { SeriesPoint, SeriesView } from './series.types.js';

/**
 * Which OHLCV axis the {@link PagedBarSeriesView} projects out of each candle.
 *
 * Crypto and equity candles carry `volume`; FX candles do not — `volume` on
 * an FX series resolves to `null` at the candle level and the corresponding
 * point is omitted.
 */
export type BarAxis = 'open' | 'high' | 'low' | 'close' | 'volume';

/**
 * How many candles the {@link PagedBarSeriesView} fetches per page.
 *
 * Series operators only ever walk back a few bars — `Crossing` needs two,
 * `Moving` needs `lookbackBars + 1`, `Channel` its window — so a page comfortably
 * covers the common walk in one repository round-trip while staying small enough
 * that a deep walk pages in bounded chunks rather than loading the whole history.
 * 64 is a pragmatic middle: big enough that no realistic lookback pages twice,
 * small enough that the early-stop case (the overwhelming majority) reads a
 * handful of candles instead of thousands.
 *
 * Not yet parameterised — a second caller wanting a different size is the signal
 * to lift it to a constructor argument (YAGNI until then).
 */
export const BAR_SERIES_PAGE_SIZE = 64;

/**
 * Lazy, paginated backward view over a `(symbolId, period, axis)` slice of the
 * candle repository, bounded above by an exclusive `before` timestamp.
 *
 * Bars are persisted elsewhere — this is a thin view, not a copy (hybrid storage
 * per ADR 0016: bars read live from `CandleRepository`). Unlike an eager load,
 * it fetches candles in fixed-size pages ({@link BAR_SERIES_PAGE_SIZE}) via
 * `CandleRepository.latestN` (newest-first, `time < before`), and only fetches a
 * page when the walk crosses into it:
 *
 * - the first `.next()` fetches page 1 (`before = the upper bound`);
 * - walking past the last point of a page fetches the next (`before = the oldest
 *   candle already seen`);
 * - a page shorter than the page size means the history is exhausted, so the
 *   walk ends.
 *
 * An operator that stops after two points triggers exactly one fetch; a deep
 * walk pages as needed; nothing loads the whole series unless something walks it
 * all.
 */
export class PagedBarSeriesView implements SeriesView {
  /**
   * @param repo - candle repository to page through `latestN`.
   * @param symbolId - symbol whose candles this view projects.
   * @param period - bar period this view is scoped to.
   * @param axis - OHLCV axis projected out of each candle.
   * @param before - exclusive upper bound: only candles with `time < before`
   *   are ever read, so a candle stored after the observation under evaluation
   *   (a later bar, or leftover cross-run data) never becomes the newest point.
   * @param pageSize - candles fetched per page; defaults to
   *   {@link BAR_SERIES_PAGE_SIZE}.
   */
  constructor(
    private readonly repo: CandleRepository,
    private readonly symbolId: string,
    private readonly period: Period,
    private readonly axis: BarAxis,
    private readonly before: number,
    private readonly pageSize: number = BAR_SERIES_PAGE_SIZE,
  ) {}

  /**
   * Page the repository newest-first, yielding one projected point at a time.
   *
   * Each call is a fresh walk with its own cursor, so the view is safe to
   * consume more than once. A candle whose axis is `null` (e.g. `volume` on FX)
   * is skipped for yielding but still counts toward the page — paging is by
   * candle, so a full page of axis-less candles still advances the cursor.
   */
  async *backwardWalk(): AsyncIterableIterator<SeriesPoint> {
    let cursor = this.before;
    while (true) {
      const page = await this.repo.latestN(this.symbolId, this.period, this.pageSize, cursor);
      if (page.length === 0) return;
      // `latestN` is newest-first, so the last element is the oldest candle in
      // the page — the next page must strictly precede it.
      const oldest = page[page.length - 1];
      for (const candle of page) {
        const v = readAxis(candle, this.axis);
        if (v !== null) {
          yield { ts: candle.time, value: { type: StateValueType.Number, value: v } };
        }
      }
      // A short page means the repository has no older candle — history exhausted.
      if (page.length < this.pageSize || oldest === undefined) return;
      cursor = oldest.time;
    }
  }

  /**
   * Latest point with `ts <= queryTs`, or `null` when none qualify.
   *
   * Walks backward — the typical "current bar" query hits the first point after
   * a single page fetch.
   */
  async asOf(queryTs: number): Promise<SeriesPoint | null> {
    for await (const point of this.backwardWalk()) {
      if (point.ts <= queryTs) return point;
    }
    return null;
  }
}

/**
 * A {@link SeriesView} that reads from `primary`, falling back to `fallback`
 * only when `primary` yields no points at all.
 *
 * Used to keep the single-point live mirror as the fallback for the current
 * forming bar when the candle repository holds no row for a `(period, axis)`
 * yet: the {@link PagedBarSeriesView} pages the repository, and only when it is
 * entirely empty does the mirror's snapshot point stand in. This mirrors the
 * earlier eager "override the mirror only when the repository has history"
 * merge, without paying an up-front probe — the fallback is consulted lazily
 * and only after the primary is observed to be empty (so a primary that has
 * rows but no point at or before `queryTs` returns `null`, never the fallback).
 */
export class FallbackSeriesView implements SeriesView {
  /**
   * @param primary - the preferred source (the repository-backed pager).
   * @param fallback - the stand-in used only when `primary` is empty.
   */
  constructor(
    private readonly primary: SeriesView,
    private readonly fallback: SeriesView,
  ) {}

  async *backwardWalk(): AsyncIterableIterator<SeriesPoint> {
    let any = false;
    for await (const point of this.primary.backwardWalk()) {
      any = true;
      yield point;
    }
    if (!any) yield* this.fallback.backwardWalk();
  }

  async asOf(queryTs: number): Promise<SeriesPoint | null> {
    let any = false;
    for await (const point of this.primary.backwardWalk()) {
      any = true;
      if (point.ts <= queryTs) return point;
    }
    // Only stand in when the primary held nothing — a non-empty primary with no
    // point at or before `queryTs` resolves to `null`, exactly as it would have
    // when the mirror was discarded outright.
    if (any) return null;
    return this.fallback.asOf(queryTs);
  }
}

/**
 * Pull one OHLCV axis off a candle. Returns `null` for axes the candle's
 * shape doesn't carry (notably `volume` on FX).
 */
function readAxis(candle: Candle, axis: BarAxis): number | null {
  switch (axis) {
    case 'open':
      return candle.open;
    case 'high':
      return candle.high;
    case 'low':
      return candle.low;
    case 'close':
      return candle.close;
    case 'volume':
      return 'volume' in candle ? candle.volume : null;
  }
}
