/**
 * Public surface of `@lametrader/core` — the pure domain layer.
 *
 * Holds entities and contracts (ports) only: no I/O, no outward imports.
 */

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
export { RuleOperatorError, validateOperatorOperands } from './rule-operator.js';
export { NumericOperator, type RuleOperator, StateOperator } from './rule-operator.types.js';
export { isBool, isEnum, isNumber, isString } from './state.js';
export { type StateValue, StateValueType } from './state.types.js';
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
