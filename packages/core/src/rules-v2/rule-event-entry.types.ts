import type { StateValue } from '../state.types.js';
import type { StateScope } from '../state-repository.types.js';
import type { EvaluationTriggerEvent } from './event.types.js';

/**
 * The kind of a v2 {@link RuleEventEntry} — what happened in the engine that
 * the rule recorded.
 *
 * The string value is the persisted/serialized tag (stable across JSON
 * round-trips).
 *
 * Greenfield shape per ADR 0016: same conceptual variants as v1 but in the
 * `RulesV2` namespace so v1 and v2 can coexist behind the feature flag.
 */
export enum RuleEventType {
  /** The rule fired its actions on a given symbol at a given timestamp. */
  Fired = 'fired',
  /** A cycle-limit overflow halted further cascading on this rule. */
  CycleOverflow = 'cycleOverflow',
  /** A `SetSymbolState` / `SetGlobalState` action wrote a value. */
  StateSet = 'stateSet',
  /** A `RemoveSymbolState` / `RemoveGlobalState` action removed a key. */
  StateRemoved = 'stateRemoved',
  /** A `Notification` action sent a message via the notifier. */
  NotificationSent = 'notificationSent',
  /** An action failed (unknown destination, bad template token, transport error). */
  Error = 'error',
  /** The rule's expiration was reached; further fires are suppressed. */
  Expired = 'expired',
}

/**
 * The OHLCV + last-tick snapshot of the firing symbol at fire-time — what the
 * rule actually saw (per v2 lookups) when its actions ran.
 *
 * Each field is `null` when the underlying lookup had no value yet for the
 * firing symbol (e.g. `current` on a bar-driven event, before any tick has
 * populated it).
 */
export interface RuleEventLookupSnapshot {
  /** Latest tick price for the firing symbol, or `null`. */
  current: number | null;
  /** Latest bar open value, or `null`. */
  open: number | null;
  /** Latest bar high value, or `null`. */
  high: number | null;
  /** Latest bar low value, or `null`. */
  low: number | null;
  /** Latest bar close value, or `null`. */
  close: number | null;
  /** Latest bar volume value, or `null`. */
  volume: number | null;
}

/**
 * Per-event context captured at fire-time — the "why did this fire here?"
 * payload inlined on the {@link FiredRuleEvent} entry.
 *
 * Carries the inbound {@link EvaluationTriggerEvent} that drove the fire and
 * the firing symbol's OHLCV snapshot at fire-time.
 */
export interface RuleEventContext {
  /** The {@link EvaluationTriggerEvent} the orchestrator was processing at fire-time. */
  inboundEvent: EvaluationTriggerEvent;
  /** OHLCV + last-tick snapshot for the firing symbol at fire-time. */
  lookupSnapshot: RuleEventLookupSnapshot;
}

/**
 * Common fields on every {@link RuleEventEntry}.
 *
 * `ruleId` is carried even though the rule's own events array is implicitly
 * scoped to its parent rule, because the same entry is mirrored onto the
 * affected symbol's events array — and there it's the only way to identify
 * which rule produced the event.
 */
interface BaseRuleEventEntry {
  /**
   * The event's source timestamp (epoch ms) — the time of the input that
   * drove the fire (e.g. a candle bar's open for OHLCV events, a quote's tick
   * time).
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
 * A `Fired` event — the umbrella entry written once per fire alongside one
 * per-action entry.
 */
export interface FiredRuleEvent extends BaseRuleEventEntry {
  type: RuleEventType.Fired;
  /** Per-event context (inbound event + firing symbol's OHLCV snapshot). */
  context: RuleEventContext;
}

/** A `CycleOverflow` event — the cascade hit the engine's cycle limit. */
export interface CycleOverflowRuleEvent extends BaseRuleEventEntry {
  type: RuleEventType.CycleOverflow;
  /** The cycle limit that was breached. */
  cycleLimit: number;
}

/** A `StateSet` event — a state-write action stored a value. */
export interface StateSetRuleEvent extends BaseRuleEventEntry {
  type: RuleEventType.StateSet;
  /** Whether the write targeted symbol-scoped or global state. */
  scope: StateScope;
  /** The state key written. */
  key: string;
  /** The value written. */
  value: StateValue;
}

/** A `StateRemoved` event — a state-remove action deleted a key. */
export interface StateRemovedRuleEvent extends BaseRuleEventEntry {
  type: RuleEventType.StateRemoved;
  /** Whether the remove targeted symbol-scoped or global state. */
  scope: StateScope;
  /** The state key removed. */
  key: string;
}

/** A `NotificationSent` event — a `Notification` action delivered a message. */
export interface NotificationSentRuleEvent extends BaseRuleEventEntry {
  type: RuleEventType.NotificationSent;
  /** The notifier destination the body was sent to. */
  destinationName: string;
  /** The rendered message body. */
  body: string;
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
 * An `Expired` event — the rule's expiration was reached and further fires
 * are suppressed. Emitted at most once per (rule, symbol).
 */
export interface ExpiredRuleEvent extends BaseRuleEventEntry {
  type: RuleEventType.Expired;
}

/**
 * One entry in a v2 rule's embedded events log.
 *
 * Tagged union over {@link RuleEventType}; mirrored onto the affected symbol's
 * embedded events array.
 */
export type RuleEventEntry =
  | FiredRuleEvent
  | CycleOverflowRuleEvent
  | StateSetRuleEvent
  | StateRemovedRuleEvent
  | NotificationSentRuleEvent
  | ErrorRuleEvent
  | ExpiredRuleEvent;
