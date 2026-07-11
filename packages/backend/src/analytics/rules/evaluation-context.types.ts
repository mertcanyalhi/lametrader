import type { ConditionOperand, Period, StateValue } from '@lametrader/core';

import type { SeriesView } from './series.types.js';

/**
 * The per-evaluation context every operator consumes.
 *
 * Built fresh for each inbound `EvaluationTriggerEvent` by the
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
  /** The firing symbol for this evaluation (always present). */
  readonly symbolId: string;
  /**
   * Current value for the operand, or `null` when the backing store has no
   * value yet (no tick seen / no bar in window / state unset).
   *
   * `interval` is the resolving leaf's row interval — required for OHLCV
   * operands to select the bar period, ignored by period-agnostic operands
   * (`Price`, state-refs, `Literal`).
   */
  resolveLatest(operand: ConditionOperand, interval?: Period): Promise<StateValue | null>;
  /**
   * Previous (one-step-back) value for the operand, or `null` when no prior
   * snapshot has been observed.
   *
   * Series-eligible operands (Price / OHLCV / `IndicatorRef`, of any value type)
   * derive `prev` from the second-newest projected point on their series.
   * State refs (`SymbolStateRef`, `GlobalStateRef`) dispatch to the
   * orchestrator-supplied `getPrevSymbolState` / `getPrevGlobalState` lookups
   * when configured; otherwise resolve to `null`.
   * `Literal` returns its constant value (literals don't change).
   *
   * Used by `State` operators (`ChangesTo` / `ChangesFrom`) — never throws.
   *
   * `interval` scopes OHLCV operands to their bar period (see
   * {@link resolveLatest}).
   */
  resolvePrev(operand: ConditionOperand, interval?: Period): Promise<StateValue | null>;
  /**
   * Ordered series view for the operand on its native timeline.
   *
   * - `Price` → the tick ring buffer for `symbolId`.
   * - OHLCV → the bar-axis projection of `(symbolId, operand row's interval)`
   *   over the configured window.
   * - `IndicatorRef` → the indicator-instance series for the bound state-key.
   * - `SymbolStateRef` / `GlobalStateRef` → a single-point series at the
   *   current value (state stores aren't time-indexed; per ADR 0016
   *   series-aware operators target tick / bar / indicator axes).
   * - `Literal` → a single stationary point (Literals are time-invariant).
   *
   * When the underlying store has no value at all, returns an empty series
   * (`length === 0`).
   *
   * `interval` scopes OHLCV operands to their bar period (see
   * {@link resolveLatest}).
   */
  resolveSeries(operand: ConditionOperand, interval?: Period): SeriesView;
}
