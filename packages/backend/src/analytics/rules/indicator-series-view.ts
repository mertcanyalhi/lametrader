import {
  type CandleRepository,
  type IndicatorComputeResult,
  type Period,
  type StateValue,
  StateValueType,
} from '@lametrader/core';
import type { IndicatorService } from '../indicators/indicator.service.js';
import { getLogger } from './engine-log.js';
import type { SeriesPoint, SeriesView } from './series.types.js';

/**
 * Scope-bound logger for the lazy indicator pager's per-page compute.
 *
 * Sits under `engine.rules.wire` alongside the rest of the rules-engine wiring
 * so a single `engine.rules.*:trace` setting enables every surface (per #436).
 */
const log = getLogger('engine.rules.wire');

/**
 * How many candles the {@link PagedIndicatorSeriesView} pages per step — and
 * therefore how many indicator points one `IndicatorService.compute` call
 * produces.
 *
 * Mirrors {@link import('./bar-series-view.js').BAR_SERIES_PAGE_SIZE}: series
 * operators only ever walk back a few points, so a page comfortably covers the
 * common walk in one round-trip while a deep walk still pages in bounded chunks
 * rather than computing the whole history. 64 is the same pragmatic middle the
 * bar pager uses.
 *
 * Not yet parameterised — a second caller wanting a different size is the signal
 * to lift it to a constructor argument (YAGNI until then).
 */
export const INDICATOR_SERIES_PAGE_SIZE = 64;

/**
 * Lazy, paginated backward view over one indicator instance's
 * `(symbolId, period, stateKey)` series, bounded above by an exclusive `before`
 * timestamp — the indicator-series parallel of
 * {@link import('./bar-series-view.js').PagedBarSeriesView}.
 *
 * Indicator points are computed on demand, never held: for each backward candle
 * page ({@link INDICATOR_SERIES_PAGE_SIZE} candles ending before the cursor via
 * `CandleRepository.latestN`), it issues **one** `IndicatorService.compute` call
 * over the page's `[oldest.time, newest.time + 1)` window and projects the
 * requested `stateKey` out of the returned rows. `compute` loads the
 * `warmup(inputs)` bars before the window internally, so every in-page row is
 * fully warmed — the recompute is bounded per page, not per point (a naïve
 * "one compute per backward step" would be O(length) per point).
 *
 * The walk pages further back only when an operator crosses into the next page;
 * a candle page shorter than the page size means history is exhausted, so the
 * walk ends. An operator that stops after two points triggers exactly one
 * candle fetch + one compute; nothing computes the whole series unless something
 * walks it all.
 */
export class PagedIndicatorSeriesView implements SeriesView {
  /**
   * @param candles - candle repository paged for the window boundaries.
   * @param indicators - the compute use-case run once per candle page.
   * @param symbolId - symbol the indicator is computed for (the firing symbol).
   * @param period - bar period the instance is computed on.
   * @param indicatorKey - registry key of the indicator to compute.
   * @param inputs - the instance's validated inputs (e.g. `{ length, source }`).
   * @param stateKey - which state field of the compute result this view projects.
   * @param before - exclusive upper bound: only candles with `time < before`
   *   are ever read, so a candle stored after the observation under evaluation
   *   (a later bar, or leftover cross-run data) never becomes the newest point.
   * @param pageSize - candles paged per step; defaults to
   *   {@link INDICATOR_SERIES_PAGE_SIZE}.
   */
  constructor(
    private readonly candles: CandleRepository,
    private readonly indicators: IndicatorService,
    private readonly symbolId: string,
    private readonly period: Period,
    private readonly indicatorKey: string,
    private readonly inputs: Record<string, unknown>,
    private readonly stateKey: string,
    private readonly before: number,
    private readonly pageSize: number = INDICATOR_SERIES_PAGE_SIZE,
  ) {}

  /**
   * Page the candle repository newest-first, computing one indicator page per
   * candle page and yielding its projected points newest-first.
   *
   * Each call is a fresh walk with its own cursor, so the view is safe to
   * consume more than once. A row whose `stateKey` value isn't a finite number
   * (warm-up `null`, or a non-numeric state field) is skipped for yielding but
   * still advances the candle cursor — paging is by candle. A compute failure
   * (asset-class mismatch / invalid inputs / unwatched symbol) is structural and
   * won't resolve on an older page, so it ends the walk with no points.
   */
  async *backwardWalk(): AsyncIterableIterator<SeriesPoint> {
    let cursor = this.before;
    while (true) {
      const page = await this.candles.latestN(this.symbolId, this.period, this.pageSize, cursor);
      if (page.length === 0) return;
      // `latestN` is newest-first: last element is the oldest candle in the page.
      const oldest = page[page.length - 1];
      const newest = page[0];
      if (oldest === undefined || newest === undefined) return;

      let result: IndicatorComputeResult;
      try {
        result = await this.indicators.compute(
          this.symbolId,
          this.indicatorKey,
          this.inputs,
          this.period,
          { from: oldest.time, to: newest.time + 1 },
        );
      } catch (error) {
        log.debug(
          {
            symbolId: this.symbolId,
            period: this.period,
            indicatorKey: this.indicatorKey,
            stateKey: this.stateKey,
            reason: error instanceof Error ? error.message : String(error),
          },
          'indicator_page_compute_failed',
        );
        return;
      }

      // `result.state` ascends by time; project the stateKey, then yield the
      // page newest-first to satisfy the backward walk.
      const projected: SeriesPoint[] = [];
      for (const row of result.state) {
        const value = toStateValue(row[this.stateKey]);
        if (value !== null) projected.push({ ts: row.time, value });
      }
      for (let i = projected.length - 1; i >= 0; i -= 1) {
        const point = projected[i];
        if (point !== undefined) yield point;
      }

      // A short candle page means the repository has no older candle — exhausted.
      if (page.length < this.pageSize) return;
      cursor = oldest.time;
    }
  }

  /**
   * Latest point with `ts <= queryTs`, or `null` when none qualify.
   *
   * Walks backward — the typical "current bar" query hits the first point after
   * a single candle page + compute.
   */
  async asOf(queryTs: number): Promise<SeriesPoint | null> {
    for await (const point of this.backwardWalk()) {
      if (point.ts <= queryTs) return point;
    }
    return null;
  }
}

/**
 * Wrap an indicator state-field value as a {@link StateValue}.
 *
 * The rules engine projects numeric indicator fields (SMA, VWMA value, …); a
 * future bool/enum field would extend this match. Returns `null` for `null`
 * (warm-up) and for shapes not yet projected (e.g. an enum `signal` string).
 */
function toStateValue(raw: unknown): StateValue | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { type: StateValueType.Number, value: raw };
  }
  return null;
}
