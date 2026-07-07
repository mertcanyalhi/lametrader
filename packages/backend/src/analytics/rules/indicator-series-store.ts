import type { CandleRepository, Period } from '@lametrader/core';
import type { IndicatorService } from '../indicators/indicator.service.js';
import type { IndicatorComputeCache } from './indicator-compute-cache.types.js';
import { PagedIndicatorSeriesView } from './indicator-series-view.js';
import type { SeriesPoint, SeriesView } from './series.types.js';

/**
 * The stored config for one profile-attached indicator instance.
 *
 * An instance carries no symbol and no period — it is computed for every symbol
 * its profile applies to, across each symbol's watched periods (the attach
 * spec). Only the identity + how to compute it is stored; the firing
 * `symbolId` + `period` are supplied per read, so one config drives every
 * `(symbol, period)` series without duplication.
 */
export interface IndicatorInstanceConfig {
  /** Profile-attached instance id; the routing key for {@link IndicatorSeriesStore.series}. */
  instanceId: string;
  /** Indicator registry key (e.g. `'sma'`). */
  indicatorKey: string;
  /** Raw input values for the indicator, passed straight to `compute`. */
  inputs: Record<string, unknown>;
}

/**
 * Registry of indicator-instance configs + factory for their lazy series views.
 *
 * Per ADR 0016 pillar 4 indicator output is derived from the persisted candle
 * history, never persisted itself. Unlike the earlier eager store (#498 / #503),
 * this holds **no** computed series: it registers each instance's
 * `(indicatorKey, inputs)` at startup (cheap, no compute) and builds a lazy
 * {@link PagedIndicatorSeriesView} on read, so an `IndicatorRef` operand a rule
 * never evaluates never computes anything — mirroring the bar-series pager
 * ({@link import('./bar-series-view.js').PagedBarSeriesView}, #505).
 *
 * The config is keyed by `instanceId` alone: multi-symbol / period isolation is
 * preserved because the firing `symbolId` + `period` are compute arguments to
 * {@link series}, not part of the stored config (the compound-key semantics
 * #498 established, now expressed at read time instead of in the slot key).
 */
export class IndicatorSeriesStore {
  /** Config per profile-attached instance, keyed by `instanceId`. */
  private readonly configs = new Map<string, IndicatorInstanceConfig>();

  /**
   * @param candles - candle repository the built views page for their windows.
   * @param indicators - the compute use-case the built views run per candle page.
   */
  constructor(
    private readonly candles: CandleRepository,
    private readonly indicators: IndicatorService,
  ) {}

  /**
   * Register one instance's config. Re-registering an `instanceId` replaces it.
   * Pure bookkeeping — no candle load, no compute.
   */
  register(config: IndicatorInstanceConfig): void {
    this.configs.set(config.instanceId, config);
  }

  /**
   * Drop one instance's config so its {@link series} resolves empty again.
   *
   * The mirror of {@link register}, called when a profile detaches an instance
   * (#519). A no-op for an unknown `instanceId`. Pure bookkeeping — no I/O.
   */
  unregister(instanceId: string): void {
    this.configs.delete(instanceId);
  }

  /**
   * A lazy backward series view for the `(symbolId, period, instanceId, stateKey)`
   * slot, bounded above by the exclusive `before` timestamp.
   *
   * Returns an empty view when the `instanceId` isn't registered — operators
   * read an empty walk and treat the operand as "no data yet" rather than
   * crashing. Building the view does no I/O; a page is fetched + computed only
   * when an operator walks or `asOf`-queries it.
   *
   * `computeCache` is the optional per-observation memo threaded from the rule
   * engine: when present, every trigger event of one observation that resolves
   * this slot shares a single `IndicatorService.compute` per page window (#548).
   */
  series(
    symbolId: string,
    period: Period,
    instanceId: string,
    stateKey: string,
    before: number,
    computeCache?: IndicatorComputeCache,
  ): SeriesView {
    const config = this.configs.get(instanceId);
    if (config === undefined) return EMPTY_SERIES;
    return new PagedIndicatorSeriesView(
      this.candles,
      this.indicators,
      symbolId,
      period,
      config.indicatorKey,
      config.inputs,
      stateKey,
      before,
      computeCache,
    );
  }
}

/**
 * A {@link SeriesView} over a pre-built array of points (ascending `ts`).
 *
 * Used for the empty / stationary operands resolved through `EvaluationContext`
 * (`EMPTY_SERIES`, literal / symbol-state singletons) and the single-point live
 * mirror — the in-memory counterpart to the lazy pagers.
 */
export class ArraySeriesView implements SeriesView {
  constructor(private readonly points: readonly SeriesPoint[]) {}

  async *backwardWalk(): AsyncIterableIterator<SeriesPoint> {
    for (let i = this.points.length - 1; i >= 0; i -= 1) {
      const point = this.points[i];
      if (point !== undefined) yield point;
    }
  }

  async asOf(queryTs: number): Promise<SeriesPoint | null> {
    for await (const point of this.backwardWalk()) {
      if (point.ts <= queryTs) return point;
    }
    return null;
  }
}

/**
 * Shared empty view returned for an unregistered instance — the view holds no
 * per-call state, so one instance is safe to share.
 */
const EMPTY_SERIES: SeriesView = new ArraySeriesView([]);
