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
   * Resolve a {@link ConditionOperand} like {@link resolve}, but also report
   * which path produced the value — the inbound event's payload, the live
   * lookups, or the operand's own literal. Used by the orchestrator's trace
   * logging to distinguish event-derived from stale-lookup-derived values
   * (the #312-class diagnostic).
   */
  resolveTraced(operand: ConditionOperand): TracedResolution;
}

/**
 * Where {@link EvaluationContext.resolveTraced} pulled its value from.
 * Used by the orchestrator's `leaf_decision` trace so a stale-lookup value
 * is one grep apart from an event-derived one (the #312-class diagnostic).
 */
export enum OperandValueSource {
  /**
   * The value came from the inbound `RuleEvent` payload — an OHLCV operand
   * whose axis matches the event's `*ValueChanged` kind on the same symbol.
   */
  Event = 'event',
  /**
   * The value came from the injected {@link EvaluationLookups} — the live
   * OHLCV cache, indicator state, or symbol / global state store.
   */
  Lookup = 'lookup',
  /** The value is a tree-local {@link OperandKind.Literal}. */
  Literal = 'literal',
}

/**
 * The resolved value plus the path it took to get there.
 */
export interface TracedResolution {
  /** Resolved value, or `null` when the lookup has no answer. */
  value: StateValue | null;
  /** Which resolution path produced {@link value}. */
  source: OperandValueSource;
}
