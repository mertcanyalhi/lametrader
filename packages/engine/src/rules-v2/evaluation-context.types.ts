import type { RulesV2, StateValue } from '@lametrader/core';

import type { SeriesView } from './series.types.js';

/**
 * The per-evaluation context every v2 operator consumes.
 *
 * Built fresh for each inbound `RulesV2.EvaluationTriggerEvent` by the
 * orchestrator (later slice — #392); operators only see this interface.
 *
 * Two reads cover the operator vocabulary:
 *
 * - {@link resolveLatest} — the current `StateValue` (used by Comparison,
 *   State, and the leaf-evaluation prelude).
 * - {@link resolveSeries} — an ordered series view (used by Crossing, Channel,
 *   Moving for backward walks + right-operand resampling per ADR 0016).
 */
export interface EvaluationContext {
  /** The firing symbol for this evaluation (always present in v2). */
  readonly symbolId: string;
  /**
   * Current value for the operand, or `null` when the backing store has no
   * value yet (no tick seen / no bar in window / state unset).
   */
  resolveLatest(operand: RulesV2.ConditionOperand): StateValue | null;
  /**
   * Ordered series view for the operand on its native timeline.
   *
   * - `Price` → the tick ring buffer for `symbolId`.
   * - OHLCV → the bar-axis projection of `(symbolId, operand row's interval)`
   *   over the configured window.
   * - `IndicatorRef` → the indicator-instance series for the bound state-key.
   * - `SymbolStateRef` / `GlobalStateRef` → a single-point series at the
   *   current value (state stores aren't time-indexed in v2; per ADR 0016
   *   series-aware operators target tick / bar / indicator axes).
   * - `Literal` → a single stationary point (Literals are time-invariant).
   *
   * When the underlying store has no value at all, returns an empty series
   * (`length === 0`).
   */
  resolveSeries(operand: RulesV2.ConditionOperand): SeriesView;
}
