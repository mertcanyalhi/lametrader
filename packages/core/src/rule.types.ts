import type { Action } from './action.types.js';
import type { ConditionNode } from './condition-tree.types.js';
import type { Expiration } from './expiration.types.js';
import type { StateValue } from './state.types.js';
import type { StateScope } from './state-repository.types.js';
import type { Trigger } from './trigger.types.js';

/**
 * How a rule selects which symbol(s) it applies to.
 *
 * The string value is the persisted/serialized tag (stable across JSON
 * round-trips).
 */
export enum RuleScopeKind {
  /** Applies to one specific watched symbol. */
  Symbol = 'symbol',
  /** Applies to every watched symbol in the parent profile. */
  AllSymbols = 'all_symbols',
}

/**
 * Rule scoped to one specific watched symbol.
 */
export interface SymbolRuleScope {
  kind: RuleScopeKind.Symbol;
  /** The watched symbol id this rule applies to. */
  symbolId: string;
}

/**
 * Rule scoped to every watched symbol in the parent profile.
 */
export interface AllSymbolsRuleScope {
  kind: RuleScopeKind.AllSymbols;
}

/**
 * A rule's scope, discriminated on `kind`.
 */
export type RuleScope = SymbolRuleScope | AllSymbolsRuleScope;

/**
 * The kind of a {@link RuleEventEntry} — what happened in the engine that the
 * rule recorded.
 *
 * The string value is the persisted/serialized tag.
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
  /** A `NotifyTelegram` action sent a message via the notifier. */
  NotificationSent = 'notificationSent',
  /** An action failed (unknown destination, bad template token, transport error). */
  Error = 'error',
}

/**
 * Common fields on every {@link RuleEventEntry}.
 *
 * `ruleId` is carried even though `Rule.events[]` is implicitly scoped to its
 * parent rule, because the same entry is mirrored onto the affected
 * `Symbol.events[]` per ADR 0012 — and there it's the only way to identify
 * which rule produced the event.
 */
interface BaseRuleEventEntry {
  /** The event timestamp (epoch ms). */
  ts: number;
  /** The rule that produced the event. */
  ruleId: string;
  /** The watched symbol the event applies to. */
  symbolId: string;
}

/**
 * A `Fired` event on the embedded events log — the umbrella entry written
 * once per fire alongside one per-action entry.
 */
export interface FiredRuleEvent extends BaseRuleEventEntry {
  type: RuleEventType.Fired;
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
 * A `NotificationSent` event — a `NotifyTelegram` action delivered a message.
 */
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
 * One entry in a {@link Rule}'s embedded events log.
 *
 * Tagged union over {@link RuleEventType}; mirrored onto `Symbol.events[]` per
 * ADR 0012.
 */
export type RuleEventEntry =
  | FiredRuleEvent
  | CycleOverflowRuleEvent
  | StateSetRuleEvent
  | StateRemovedRuleEvent
  | NotificationSentRuleEvent
  | ErrorRuleEvent;

/**
 * The kind of a {@link RuleHistoryEntry} — a lifecycle change to the rule
 * itself.
 *
 * The string value is the persisted/serialized tag.
 */
export enum RuleHistoryType {
  /** The rule was created. */
  Created = 'created',
  /** The rule's fields were updated. */
  Updated = 'updated',
  /** The rule was enabled. */
  Enabled = 'enabled',
  /** The rule was disabled. */
  Disabled = 'disabled',
}

/**
 * One entry in a {@link Rule}'s embedded history log — a lifecycle event on
 * the rule itself.
 */
export interface RuleHistoryEntry {
  /** What kind of change happened. */
  type: RuleHistoryType;
  /** When it happened (epoch ms). */
  ts: number;
}

/**
 * A persisted rule: the trigger / condition / actions definition plus
 * lifecycle metadata and embedded events / history logs.
 */
export interface Rule {
  /** Generated, stable id. */
  id: string;
  /** The parent profile's id. */
  profileId: string;
  /** Human-readable name (non-empty). */
  name: string;
  /** Optional free-text description. */
  description?: string;
  /** Which symbol(s) the rule applies to. */
  scope: RuleScope;
  /** The condition tree evaluated each tick. */
  condition: ConditionNode;
  /** When/how often the rule may re-fire. */
  trigger: Trigger;
  /** When the rule stops firing (or `null` for never). */
  expiration: Expiration;
  /** Side-effects performed on fire (non-empty). */
  actions: Action[];
  /** Whether the rule is currently active. */
  enabled: boolean;
  /** Ordering hint within the parent profile. */
  order: number;
  /** Embedded events log (per ADR 0012). */
  events: RuleEventEntry[];
  /** Embedded lifecycle history log. */
  history: RuleHistoryEntry[];
  /** Creation time (epoch ms). */
  createdAt: number;
  /** Last-update time (epoch ms). */
  updatedAt: number;
}
