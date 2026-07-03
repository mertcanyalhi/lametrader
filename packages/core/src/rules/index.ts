/**
 * Public surface of the rules type namespace.
 *
 * Re-exported unprefixed at the `@lametrader/core` package root (per ADR 0016 §6
 * and the cleanup completed in issue #422).
 */

export {
  type Action,
  ActionKind,
  type NotificationAction,
  NotificationChannel,
  type RemoveGlobalStateAction,
  type RemoveSymbolStateAction,
  type SetGlobalStateAction,
  type SetSymbolStateAction,
} from './action.types.js';
export {
  type ChannelLeafCondition,
  type ComparisonLeafCondition,
  type ConditionNode,
  ConditionNodeKind,
  type CrossingLeafCondition,
  type LeafCondition,
  LeafConditionFamily,
  type MovingLeafCondition,
  type StateLeafCondition,
} from './condition.types.js';
export { normalizeRule } from './condition-normalize.js';
export {
  collectConditionIntervals,
  leafNeedsInterval,
  leafOperands,
  operandNeedsInterval,
  validateRuleCondition,
} from './condition-validate.js';
export {
  type BarClosedEvent,
  type BarOpenedEvent,
  type CloseChangedEvent,
  type DataUpdateEvent,
  DataUpdateKind,
  type EvaluationTriggerEvent,
  EvaluationTriggerKind,
  type GlobalStateChangedEvent,
  type HighChangedEvent,
  type IndicatorChangedEvent,
  type LowChangedEvent,
  type OpenChangedEvent,
  type RuleEvent,
  type SymbolStateChangedEvent,
  type TickEvent,
  type TimerEvent,
  type VolumeChangedEvent,
} from './event.types.js';
export type {
  EventLog,
  EventLogAppendListener,
  EventLogAppendTarget,
} from './event-log.types.js';
export { type ConditionOperand, OperandKind } from './operand.types.js';
export {
  ChannelOperator,
  ComparisonOperator,
  CrossingOperator,
  MovingOperator,
  type Operator,
  StateOperator,
} from './operator.types.js';
export type { Rule } from './rule.types.js';
export {
  type CycleOverflowRuleEvent,
  type ErrorRuleEvent,
  type FiredRuleEvent,
  type NotificationSentRuleEvent,
  type RuleEventContext,
  type RuleEventEntry,
  type RuleEventLookupSnapshot,
  RuleEventType,
  type StateRemovedRuleEvent,
  type StateSetRuleEvent,
} from './rule-event-entry.types.js';
export type { RuleRepository } from './rule-repository.types.js';
export {
  type AllSymbolsRuleScope,
  type RuleScope,
  RuleScopeKind,
  type SymbolRuleScope,
  type SymbolsRuleScope,
} from './scope.types.js';
export {
  type EveryTimeTrigger,
  type OncePerBarCloseTrigger,
  type OncePerBarOpenTrigger,
  type OncePerBarTrigger,
  type OncePerIntervalTrigger,
  type OnceTrigger,
  type Trigger,
  TriggerKind,
} from './trigger.types.js';
