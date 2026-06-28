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
  /**
   * Symbol-scoped state by `(profileId, symbolId, key)`, or `null`.
   * State is partitioned by profile (#281), so the rule's `profileId` is
   * the first arg.
   */
  getSymbolState(profileId: string, symbolId: string, key: string): StateValue | null;
  /**
   * Global-scope state by `(profileId, key)`, or `null`.
   * State is partitioned by profile (#281), so the rule's `profileId` is
   * the first arg.
   */
  getGlobalState(profileId: string, key: string): StateValue | null;

  /**
   * Pre-change ("prev") counterparts to each `get*` lookup.
   * Returns the value observed *before* the most recent write to the slot
   * (or `null` until two writes have happened). The crossing and `changes-*`
   * evaluators need per-operand history; the orchestrator's
   * `EvaluationContext.resolvePrev` dispatches through these.
   */

  /** Previous current ("last") price for the symbol. */
  getPrevCurrentValue(symbolId: string): number | null;
  /** Previous open value for the symbol. */
  getPrevOpenValue(symbolId: string): number | null;
  /** Previous high value for the symbol. */
  getPrevHighValue(symbolId: string): number | null;
  /** Previous low value for the symbol. */
  getPrevLowValue(symbolId: string): number | null;
  /** Previous close value for the symbol. */
  getPrevCloseValue(symbolId: string): number | null;
  /** Previous volume value for the symbol. */
  getPrevVolumeValue(symbolId: string): number | null;
  /** Previous indicator-instance state by `(instanceId, stateKey)`. */
  getPrevIndicatorValue(instanceId: string, stateKey: string): StateValue | null;
  /** Previous symbol-scoped state by `(profileId, symbolId, key)`. */
  getPrevSymbolState(profileId: string, symbolId: string, key: string): StateValue | null;
  /** Previous global-scope state by `(profileId, key)`. */
  getPrevGlobalState(profileId: string, key: string): StateValue | null;
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
  /**
   * Resolve a {@link ConditionOperand} to its *previous* {@link StateValue}
   * — the value observed before the latest write to the operand's slot.
   * Returns `null` until the slot has been written twice. `Literal` operands
   * have no time dimension, so `resolvePrev` returns the same value as
   * {@link resolve}.
   *
   * Crossing and `changes-*` evaluators need both `prev` and `current` per
   * operand (literal-, indicator-, OHLCV-, state-backed alike); the
   * orchestrator's leaf dispatch reads them from here.
   */
  resolvePrev(operand: ConditionOperand): StateValue | null;
}
