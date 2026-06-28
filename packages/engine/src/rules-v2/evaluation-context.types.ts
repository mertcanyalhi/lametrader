import type { Period, RulesV2, StateValue } from '@lametrader/core';

import type { BarAxis } from './bar-series.js';
import type { SeriesView } from './series.types.js';

/**
 * The synchronous lookup surface a v2 {@link EvaluationContext} dispatches
 * operand resolution to.
 *
 * Latest-value getters return `null` when nothing has been observed for the
 * slot.
 * Series getters return `null` when the operand kind isn't series-eligible
 * (state-refs, non-numeric indicator state-keys) or the underlying store is
 * empty.
 *
 * The orchestrator (issue #394) is responsible for keeping the underlying
 * caches warm — pushing ticks into per-symbol rings, loading bar windows
 * from the candle repo before evaluation, and rebuilding indicator series at
 * startup via {@link IndicatorSeriesStore.rebuild}.
 */
export interface EvaluationLookups {
  /** Latest tick price for `symbolId`, or `null`. */
  latestPrice(symbolId: string): number | null;
  /** Latest OHLCV value for `(symbolId, period, axis)`, or `null`. */
  latestOhlcv(symbolId: string, period: Period, axis: BarAxis): number | null;
  /** Latest indicator state-key value for `(instanceId, stateKey)`, or `null`. */
  latestIndicator(instanceId: string, stateKey: string): StateValue | null;
  /** Latest symbol-state value for `(profileId, symbolId, key)`, or `null`. */
  latestSymbolState(profileId: string, symbolId: string, key: string): StateValue | null;
  /** Latest global-state value for `(profileId, key)`, or `null`. */
  latestGlobalState(profileId: string, key: string): StateValue | null;
  /** Numeric tick series for `symbolId`, or `null` when the ring is empty. */
  priceSeries(symbolId: string): SeriesView | null;
  /** Numeric bar-axis series for `(symbolId, period, axis)`, or `null`. */
  barSeries(symbolId: string, period: Period, axis: BarAxis): SeriesView | null;
  /**
   * Numeric indicator-state-key series for `(symbolId, period, instanceId, stateKey)`,
   * or `null` when the state-key isn't numeric / nothing rebuilt yet.
   */
  indicatorSeries(
    symbolId: string,
    period: Period,
    instanceId: string,
    stateKey: string,
  ): SeriesView | null;
}

/**
 * The per-evaluation view a v2 leaf evaluator consumes.
 *
 * Built fresh for each inbound {@link RulesV2.EvaluationTriggerEvent}; pure
 * — every read dispatches into the injected {@link EvaluationLookups}, no
 * I/O, no clocks.
 *
 * Series-aware operators (Crossing / Channel / Moving) walk the operand's
 * own series; snapshot operators (Comparison / State) read `resolveLatest`
 * only.
 */
export interface EvaluationContext {
  /** The event that triggered this evaluation. */
  event: RulesV2.EvaluationTriggerEvent;
  /** The firing rule's profile id; state-ref resolution scopes against it. */
  profileId: string;
  /** The firing symbol id; OHLCV / Price / IndicatorRef resolution scopes against it. */
  symbolId: string;
  /**
   * Resolve a {@link RulesV2.ConditionOperand} to its latest {@link StateValue},
   * or `null` when the lookup has no value for the slot.
   */
  resolveLatest(operand: RulesV2.ConditionOperand): StateValue | null;
  /**
   * Resolve a {@link RulesV2.ConditionOperand} to its numeric series.
   *
   * Returns `null` for operand kinds that aren't series-eligible
   * (state-refs, `Literal`, non-numeric indicator state-keys).
   */
  resolveSeries(operand: RulesV2.ConditionOperand): SeriesView | null;
}
