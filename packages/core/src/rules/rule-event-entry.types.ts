import type { Period } from '../config.types.js';
import type { StateScope, StateValue } from '../index.js';
import type { EvaluationTriggerEvent } from './event.types.js';

/**
 * The kind of a {@link RuleEventEntry} — what happened on the engine that
 * was recorded against a rule + symbol.
 *
 * The string value is the persisted/serialized tag (stable across JSON
 * round-trips).
 *
 * The union is routed through the standalone {@link EventLog} port (per
 * ADR 0016) and re-exported at the `@lametrader/core` package root.
 *
 * There is no `Expired` variant: the dispatcher's `listEnabledForSymbol`
 * already drops expired rules at the lookup boundary, so the orchestrator
 * never needs to emit one.
 */
export enum RuleEventType {
  /** The rule fired its actions on a given symbol at a given timestamp. */
  Fired = 'fired',
  /** A `Notification` action delivered a message via the notifier. */
  NotificationSent = 'notificationSent',
  /** A `SetSymbolState` / `SetGlobalState` action wrote a value. */
  StateSet = 'stateSet',
  /** A `RemoveSymbolState` / `RemoveGlobalState` action removed a key. */
  StateRemoved = 'stateRemoved',
  /** An action failed (unknown destination, bad template token, transport error). */
  Error = 'error',
  /** A cycle-limit overflow halted further cascading on this event. */
  CycleOverflow = 'cycleOverflow',
}

/**
 * Common fields on every {@link RuleEventEntry}.
 *
 * `ruleId` is carried on the symbol-log mirror so each entry stays
 * self-identifying when the same fire is appended to both the rule's and
 * the affected symbol's events array.
 */
interface BaseRuleEventEntry {
  /**
   * The event's source timestamp (epoch ms) — the time of the input that
   * drove the fire (bar boundary for bar events, tick time for ticks).
   */
  ts: number;
  /**
   * Wall-clock at which the {@link EventLog} adapter persisted the entry
   * (epoch ms). Stamped at append time.
   */
  firedAt?: number;
  /** The rule that produced the event. */
  ruleId: string;
  /** The watched symbol the event applies to. */
  symbolId: string;
}

/**
 * OHLCV snapshot of the firing symbol at fire-time — what the rule actually
 * saw (per the orchestrator's lookups cache) when its actions ran.
 *
 * Each field is `null` when the underlying lookup had no value yet for the
 * firing symbol (e.g. `current` before any quote stream has populated it).
 */
export interface RuleEventLookupSnapshot {
  /**
   * The bar period the OHLCV axes below were captured at — the rule's
   * referenced OHLCV `interval` (the trigger's period for bar-cadence
   * triggers, else the first OHLCV row interval in the condition).
   *
   * Optional: `undefined` when the rule references no OHLCV operand, and on
   * pre-period-aware entries persisted before this field existed (they still
   * deserialize and render as "—").
   */
  period?: Period;
  /** Latest current ("last") price for the firing symbol, or `null`. */
  current: number | null;
  /** Latest open value, or `null`. */
  open: number | null;
  /** Latest high value, or `null`. */
  high: number | null;
  /** Latest low value, or `null`. */
  low: number | null;
  /** Latest close value, or `null`. */
  close: number | null;
  /** Latest volume value, or `null`. */
  volume: number | null;
}

/**
 * Per-event context captured at fire-time — the "why did this fire here?"
 * payload.
 * Carries the inbound {@link EvaluationTriggerEvent} that satisfied the gate
 * plus the firing symbol's OHLCV snapshot at fire-time.
 */
export interface RuleEventContext {
  /** The {@link EvaluationTriggerEvent} the orchestrator was processing at fire-time. */
  inboundEvent: EvaluationTriggerEvent;
  /** OHLCV snapshot for the firing symbol at fire-time. */
  lookupSnapshot: RuleEventLookupSnapshot;
}

/**
 * A `Fired` event — the umbrella entry written once per fire alongside one
 * per-action entry.
 */
export interface FiredRuleEvent extends BaseRuleEventEntry {
  type: RuleEventType.Fired;
  /** Per-event context captured at fire-time. */
  context: RuleEventContext;
}

/**
 * A `NotificationSent` event — a `Notification` action delivered a message.
 */
export interface NotificationSentRuleEvent extends BaseRuleEventEntry {
  type: RuleEventType.NotificationSent;
  /** The notifier destination the body was sent to. */
  destinationName: string;
  /** The rendered message body. */
  body: string;
}

/**
 * A `StateSet` event — a state-write action stored a value.
 */
export interface StateSetRuleEvent extends BaseRuleEventEntry {
  type: RuleEventType.StateSet;
  /** Whether the write targeted symbol-scoped or global state. */
  scope: StateScope;
  /** The state key written. */
  key: string;
  /** The value written. */
  value: StateValue;
}

/**
 * A `StateRemoved` event — a state-remove action deleted a key.
 */
export interface StateRemovedRuleEvent extends BaseRuleEventEntry {
  type: RuleEventType.StateRemoved;
  /** Whether the remove targeted symbol-scoped or global state. */
  scope: StateScope;
  /** The state key removed. */
  key: string;
}

/**
 * An `Error` event — an action failed (unknown destination, bad template
 * token, transport error, etc.).
 */
export interface ErrorRuleEvent extends BaseRuleEventEntry {
  type: RuleEventType.Error;
  /** Human-readable reason. */
  reason: string;
}

/**
 * A `CycleOverflow` event — the cascade hit the engine's cycle limit.
 */
export interface CycleOverflowRuleEvent extends BaseRuleEventEntry {
  type: RuleEventType.CycleOverflow;
  /** The cycle limit that was breached. */
  cycleLimit: number;
}

/**
 * One entry on the events log — emitted by the orchestrator + action
 * runner and appended to both the rule's and the affected symbol's log.
 *
 * Tagged union over {@link RuleEventType}.
 */
export type RuleEventEntry =
  | FiredRuleEvent
  | NotificationSentRuleEvent
  | StateSetRuleEvent
  | StateRemovedRuleEvent
  | ErrorRuleEvent
  | CycleOverflowRuleEvent;
