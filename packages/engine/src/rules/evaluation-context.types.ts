import type { ConditionOperand, RuleEvent, StateValue } from '@lametrader/core';

/**
 * Pure lookups the {@link EvaluationContext} uses to resolve operands. The
 * orchestrator wires these to live caches and the state store.
 *
 * Narrow per-shape lookups (ISP) so the unit tier can fake exactly the slice
 * a test exercises.
 */
export interface EvaluationLookups {
  /** Latest current ("last") price for the symbol, or `null` if unknown. */
  getCurrentValue(symbolId: string): number | null;
  /** Latest open value for the symbol, or `null` if unknown. */
  getOpenValue(symbolId: string): number | null;
  /** Latest high value for the symbol, or `null` if unknown. */
  getHighValue(symbolId: string): number | null;
  /** Latest low value for the symbol, or `null` if unknown. */
  getLowValue(symbolId: string): number | null;
  /** Latest close value for the symbol, or `null` if unknown. */
  getCloseValue(symbolId: string): number | null;
  /** Latest volume value for the symbol, or `null` if unknown. */
  getVolumeValue(symbolId: string): number | null;
  /** Indicator-instance state by `(instanceId, stateKey)`, or `null`. */
  getIndicatorValue(instanceId: string, stateKey: string): StateValue | null;
  /** Symbol-scoped state by `(symbolId, key)`, or `null`. */
  getSymbolState(symbolId: string, key: string): StateValue | null;
  /** Global-scope state by `key`, or `null`. */
  getGlobalState(key: string): StateValue | null;
}

/**
 * The per-evaluation context the rule evaluator consumes.
 *
 * Built fresh for each inbound {@link RuleEvent}. Pure: every read returns
 * what the injected lookups (or the event itself) already hold; no I/O, no
 * clocks.
 */
export interface EvaluationContext {
  /** The event that triggered this evaluation. */
  event: RuleEvent;
  /**
   * The pre-change value of the inbound event's "value" axis, wrapped as a
   * {@link StateValue} for uniform comparison; `null` on the first
   * observation (or for `TimerEvent`s, which carry no value).
   */
  prev: StateValue | null;
  /**
   * The post-change value of the inbound event's "value" axis, wrapped as a
   * {@link StateValue}; `null` on removals (or for `TimerEvent`s).
   */
  current: StateValue | null;
  /**
   * Resolve a {@link ConditionOperand} to its current {@link StateValue}, or
   * `null` if the underlying lookup has no value (e.g. an OHLCV operand on
   * a `TimerEvent` whose `symbolId` is `null`).
   */
  resolve(operand: ConditionOperand): StateValue | null;
}
