/**
 * Public surface of `@lametrader/core` — the pure domain layer.
 *
 * Holds entities and contracts (ports) only: no I/O, no outward imports.
 */

export { ActionError, validateAction } from './action.js';
export {
  type Action,
  ActionKind,
  type NotifyTelegramAction,
  type RemoveGlobalStateAction,
  type RemoveSymbolStateAction,
  type SetGlobalStateAction,
  type SetSymbolStateAction,
} from './action.types.js';
export {
  BackfillConflictError,
  CandleError,
  DEFAULT_CANDLE_LIMIT,
  MAX_CANDLE_LIMIT,
  parseBackfillRange,
  parseCandleLimit,
  periodMillis,
} from './candle.js';
export type {
  BackfillRange,
  BaseCandle,
  Candle,
  CandleBatch,
  CandlePage,
  CandleRepository,
  CryptoCandle,
  EquityCandle,
  FxCandle,
} from './candle.types.js';
export { operandValueType } from './condition-operand.js';
export { type ConditionOperand, OperandKind } from './condition-operand.types.js';
export { RuleConditionError, validateConditionTree } from './condition-tree.js';
export { type ConditionNode, ConditionNodeKind } from './condition-tree.types.js';
export { ConfigError, defaultConfig, mergeConfig, parseConfig } from './config.js';
export { type Config, ConfigKey, type ConfigRepository, Period } from './config.types.js';
export type { EventLog } from './event-log.types.js';
export { ExpirationError, validateExpiration } from './expiration.js';
export type { Expiration } from './expiration.types.js';
export type { FiringStateRepository } from './firing-state-repository.types.js';
export {
  IndicatorError,
  IndicatorInstanceNotFoundError,
  IndicatorNotFoundError,
  resolveSource,
  validateIndicatorInputs,
} from './indicator.js';
export {
  type EnumFieldDescriptor,
  type EnumOption,
  type EnumStateFieldDescriptor,
  type FieldDescriptor,
  FieldType,
  type IndicatorComputeResult,
  type IndicatorDefinition,
  type IndicatorModule,
  type IndicatorStateEvent,
  type IndicatorStateListener,
  type IndicatorStatePoint,
  type InferFieldValue,
  type InferInputs,
  type InferStateRow,
  type InferStateSeries,
  type InferStateValue,
  type NumberFieldDescriptor,
  type NumberStateFieldDescriptor,
  Pane,
  PriceSource,
  RenderKind,
  type SourceFieldDescriptor,
  type StateFieldDescriptor,
} from './indicator.types.js';
export {
  BOT_TOKEN_MAX,
  CHAT_ID_MAX,
  DESTINATION_NAME_MAX,
  RULE_DESCRIPTION_MAX,
  RULE_NAME_MAX,
  STATE_KEY_MAX,
  SYMBOL_ID_MAX,
  TELEGRAM_TEMPLATE_MAX,
} from './limits.js';
export { type Notifier, UnknownDestinationError } from './notifier.types.js';
export {
  mergeProfileFields,
  ProfileConflictError,
  ProfileError,
  ProfileNotFoundError,
  parseProfileFields,
  parseProfileScope,
} from './profile.js';
export {
  type AllScope,
  type IndicatorInstance,
  type Profile,
  type ProfileFields,
  type ProfileRepository,
  ProfileScope,
  type ProfileScopeSpec,
  type SymbolsScope,
} from './profile.types.js';
export { computeQuote } from './quote.js';
export type {
  EnrichedSymbol,
  SymbolQuote,
  SymbolQuoteEvent,
  SymbolQuoteListener,
} from './quote.types.js';
export { RuleError, RuleNotFoundError, validateRule } from './rule.js';
export {
  type AllSymbolsRuleScope,
  type CycleOverflowRuleEvent,
  type ErrorRuleEvent,
  type ExpiredRuleEvent,
  type FiredRuleEvent,
  type NotificationSentRuleEvent,
  type Rule,
  type RuleEventContext,
  type RuleEventEntry,
  type RuleEventLookupSnapshot,
  RuleEventType,
  type RuleHistoryEntry,
  RuleHistoryType,
  type RuleScope,
  RuleScopeKind,
  type StateRemovedRuleEvent,
  type StateSetRuleEvent,
  type SymbolRuleScope,
} from './rule.types.js';
export {
  type CloseValueChangedEvent,
  type CurrentValueChangedEvent,
  type GlobalStateChangedEvent,
  type HighValueChangedEvent,
  type IndicatorValueChangedEvent,
  type LowValueChangedEvent,
  type OpenValueChangedEvent,
  type RuleEvent,
  RuleEventKind,
  type SymbolStateChangedEvent,
  type TimerEvent,
  type VolumeValueChangedEvent,
} from './rule-event.types.js';
export { RuleOperatorError, validateOperatorOperands } from './rule-operator.js';
export { NumericOperator, type RuleOperator, StateOperator } from './rule-operator.types.js';
export type { RuleRepository } from './rule-repository.types.js';
export { isBool, isEnum, isNumber, isString } from './state.js';
export { type StateValue, StateValueType } from './state.types.js';
export {
  type GlobalStateScope,
  type StateChangedEvent,
  type StateChangedListener,
  type StateRepository,
  StateScope,
  type StateScopeSpec,
  type SymbolStateScope,
} from './state-repository.types.js';
export {
  assertInstrumentTypeMatchesId,
  MarketDataError,
  parseSymbolPeriods,
  SymbolConflictError,
  SymbolError,
  SymbolNotFoundError,
  symbolType,
} from './symbol.js';
export {
  type CandleFeed,
  type Instrument,
  type MarketDataSource,
  type SymbolDiscovery,
  SymbolType,
  type WatchedSymbol,
  type WatchlistRepository,
} from './symbol.types.js';
export { listSymbolStateEvents } from './symbol-state-events.js';
export {
  type TelegramDestination,
  TelegramDestinationError,
  type TelegramDestinationLookup,
  TelegramDestinationNotFoundError,
  type TelegramDestinationSummary,
} from './telegram-destination.types.js';
export { DEFAULT_TRIGGER_INTERVAL_MS, TriggerError, validateTrigger } from './trigger.js';
export {
  type OncePerBarCloseTrigger,
  type OncePerBarTrigger,
  type OncePerMinuteTrigger,
  type OnceTrigger,
  type Trigger,
  TriggerKind,
} from './trigger.types.js';
