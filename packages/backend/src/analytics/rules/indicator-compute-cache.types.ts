import type { IndicatorComputeResult, Period } from '@lametrader/core';

/**
 * The meaningful identity of one `IndicatorService.compute` read.
 *
 * Two reads with an equal key produce byte-identical results (compute is a pure
 * read over stored candles), so a {@link IndicatorComputeCache} memoizes on this
 * tuple rather than on the raw call arguments — an explicit, checkable key, not a
 * `JSON.stringify` of the whole args list that would break on argument order or
 * an optional range.
 *
 * `from` / `to` are the resolved (never `undefined`) exclusive-`to` window the
 * pager passes to `compute`; because the window advances with each bar (a higher
 * upper bound), the next observation keys a different entry and recomputes — the
 * memo can never leak a stale value across bars.
 */
export interface IndicatorComputeKey {
  /** Symbol the indicator is computed for (the firing symbol). */
  symbolId: string;
  /** Indicator registry key (e.g. `'sma'`). */
  indicatorKey: string;
  /** The instance's validated inputs (e.g. `{ length, source }`). */
  inputs: Record<string, unknown>;
  /** Bar period the instance is computed on. */
  period: Period;
  /** Inclusive lower bound of the compute window (epoch ms). */
  from: number;
  /** Exclusive upper bound of the compute window (epoch ms). */
  to: number;
}

/**
 * A memo over `IndicatorService.compute`, scoped to a single observation.
 *
 * Within one candle the rule engine fans one observation into several trigger
 * events (`BarOpened` / `BarClosed` / `Tick`, plus one per matching rule), each
 * building a fresh evaluation context; a shared indicator operand would
 * otherwise recompute once per event with byte-identical arguments (#548).
 * A cache instance created fresh per {@link import('./wire/wire-rule-engine.js')}
 * event batch collapses those to one compute per distinct
 * {@link IndicatorComputeKey}.
 *
 * The instance is deliberately per-observation: different symbols' batches run
 * concurrently on separate serializer chains, so each batch owns its own cache —
 * a shared, cleared-between-batches instance would race and leak across symbols.
 */
export interface IndicatorComputeCache {
  /**
   * Return the memoized compute for `key`, or run `load` once and memoize its
   * promise for every later call sharing the same identity.
   *
   * `load` is the pure `IndicatorService.compute` read the pager would otherwise
   * issue directly; the cache never inspects it beyond invoking it at most once
   * per key.
   */
  compute(
    key: IndicatorComputeKey,
    load: () => Promise<IndicatorComputeResult>,
  ): Promise<IndicatorComputeResult>;
}
