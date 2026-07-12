import {
  type Candle,
  type CandleRepository,
  type Period,
  periodMillis,
  StateValueType,
} from '@lametrader/core';

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
 * A {@link SeriesView} for a coarse `period` that layers a **forming** bar —
 * synthesized on the fly from the `finePeriod` candles inside the current,
 * not-yet-closed coarse window — on top of the closed coarse bars behind it.
 *
 * The engine only ever sees a coarse bar once it has closed (the backtest feed
 * withholds it until its completion time; live polling persists it on close).
 * Between closes a coarse-period operand therefore reads the *previous* closed
 * bar. This view instead rolls the finer candles observed so far in the current
 * window up into a synthetic bar so a coarse operand tracks intrabar, exactly as
 * a real forming bar would:
 *
 * - `open` = the oldest fine candle's open in the window,
 * - `close` = the newest fine candle's close,
 * - `high` / `low` = the window extremes,
 * - `volume` = the window sum (null when the asset carries no volume, e.g. FX).
 *
 * The forming point's `ts` is the window's open time. Closed history is served
 * by an inner {@link PagedBarSeriesView} bounded strictly below that window
 * open, so the synthetic bar and the stored bars never overlap.
 *
 * Unlike {@link FallbackSeriesView} (which stands in only when the primary is
 * *empty*), this always prepends the forming bar as the newest point — layering,
 * not fallback — so it keeps working once closed coarse history exists.
 */
export class FormingBarSeriesView implements SeriesView {
  /**
   * @param repo - candle repository read for both the fine window and the closed tail.
   * @param symbolId - symbol whose candles this view projects.
   * @param period - the coarse bar period the forming bar is synthesized for.
   * @param finePeriod - the finer period rolled up into the forming bar
   *   (must divide `period` and actually be stored for `symbolId`).
   * @param axis - OHLCV axis projected out of each candle.
   * @param before - exclusive upper bound: no candle with `time >= before` is read.
   * @param pageSize - candles fetched per page; defaults to {@link BAR_SERIES_PAGE_SIZE}.
   */
  constructor(
    private readonly repo: CandleRepository,
    private readonly symbolId: string,
    private readonly period: Period,
    private readonly finePeriod: Period,
    private readonly axis: BarAxis,
    private readonly before: number,
    private readonly pageSize: number = BAR_SERIES_PAGE_SIZE,
  ) {}

  /**
   * Yield the forming bar (when the current window holds any fine candle),
   * newest, then delegate to the closed coarse tail below the window open.
   */
  async *backwardWalk(): AsyncIterableIterator<SeriesPoint> {
    const forming = await this.formingAt(this.before - 1);
    if (forming.value !== null) {
      yield {
        ts: forming.windowStart,
        value: { type: StateValueType.Number, value: forming.value },
      };
    }
    yield* this.closedTail(forming.windowStart).backwardWalk();
  }

  /**
   * Latest point with `ts <= queryTs`. The forming bar's `ts` is its window
   * open (`<= queryTs`), so when the window has fine candles it qualifies and
   * wins; otherwise the closed tail answers.
   */
  async asOf(queryTs: number): Promise<SeriesPoint | null> {
    const cap = Math.min(queryTs, this.before - 1);
    const forming = await this.formingAt(cap);
    if (forming.value !== null) {
      return {
        ts: forming.windowStart,
        value: { type: StateValueType.Number, value: forming.value },
      };
    }
    return this.closedTail(forming.windowStart).asOf(queryTs);
  }

  /**
   * Aggregate the `finePeriod` candles in the coarse window containing `cap`
   * (inclusive) into this view's axis value, plus that window's open time.
   * `value` is null when the window holds no fine candle carrying the axis.
   */
  private async formingAt(cap: number): Promise<{ windowStart: number; value: number | null }> {
    const coarseMs = periodMillis(this.period);
    const windowStart = Math.floor(cap / coarseMs) * coarseMs;
    const window: Candle[] = [];
    let cursor = cap + 1;
    while (true) {
      const page = await this.repo.latestN(this.symbolId, this.finePeriod, this.pageSize, cursor);
      if (page.length === 0) break;
      let crossed = false;
      for (const c of page) {
        if (c.time < windowStart) {
          crossed = true;
          break;
        }
        window.push(c);
      }
      const oldest = page[page.length - 1];
      if (crossed || page.length < this.pageSize || oldest === undefined) break;
      cursor = oldest.time;
    }
    return { windowStart, value: aggregateAxis(window, this.axis) };
  }

  /** The closed coarse bars strictly below the current window open. */
  private closedTail(windowStart: number): PagedBarSeriesView {
    return new PagedBarSeriesView(
      this.repo,
      this.symbolId,
      this.period,
      this.axis,
      windowStart,
      this.pageSize,
    );
  }
}

/**
 * Roll one OHLCV axis across a window's fine candles (newest-first) up into the
 * forming coarse bar's value for that axis: open = oldest, close = newest,
 * high/low = extremes, volume = sum. Null when no candle in the window carries
 * the axis (e.g. `volume` on FX).
 */
function aggregateAxis(newestFirst: readonly Candle[], axis: BarAxis): number | null {
  let any = false;
  let acc =
    axis === 'high' ? Number.NEGATIVE_INFINITY : axis === 'low' ? Number.POSITIVE_INFINITY : 0;
  let open = 0;
  let close = 0;
  let closeSet = false;
  for (const candle of newestFirst) {
    const v = readAxis(candle, axis);
    if (v === null) continue;
    any = true;
    switch (axis) {
      case 'high':
        acc = Math.max(acc, v);
        break;
      case 'low':
        acc = Math.min(acc, v);
        break;
      case 'volume':
        acc += v;
        break;
      case 'close':
        if (!closeSet) {
          close = v;
          closeSet = true;
        }
        break;
      case 'open':
        open = v; // newest-first walk: the last write is the oldest candle
        break;
    }
  }
  if (!any) return null;
  if (axis === 'close') return close;
  if (axis === 'open') return open;
  return acc;
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
