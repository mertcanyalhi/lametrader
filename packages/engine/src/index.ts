/**
 * Public surface of `@lametrader/engine` — the application layer.
 *
 * Orchestrates use-cases by wiring `core` ports to driven adapters.
 */

export {
  type BackfillJob,
  type BackfillJobListener,
  BackfillJobStatus,
} from './candles/backfill-job.types.js';
export { BackfillJobService } from './candles/backfill-job-service.js';
export { BackfillService } from './candles/backfill-service.js';
export type {
  BackfillProgress,
  BackfillProgressListener,
  BackfillSummary,
} from './candles/backfill-service.types.js';
export { InMemoryCandleRepository } from './candles/in-memory-candle-repository.js';
export { MongoCandleRepository } from './candles/mongo-candle-repository.js';
export { PollingService } from './candles/polling-service.js';
export type {
  CandleEvent,
  CandleListener,
  PollingOptions,
} from './candles/polling-service.types.js';
export { ConfigService } from './config/config-service.js';
export { InMemoryConfigRepository } from './config/in-memory-config-repository.js';
export { MongoConfigRepository } from './config/mongo-config-repository.js';
export { type ConnectedServices, type ConnectOptions, connectServices } from './connect.js';
export { defaultIndicators } from './indicators/default-indicators.js';
export { type DefineIndicatorSpec, defineIndicator } from './indicators/define-indicator.js';
export { IndicatorRegistry } from './indicators/indicator-registry.js';
export {
  IndicatorService,
  type IndicatorServiceOptions,
  type IndicatorSubscribeInput,
} from './indicators/indicator-service.js';
export { movingAverage } from './indicators/sma.js';
export { volumeWeightedMovingAverage } from './indicators/vwma.js';
export { getLogger } from './log.js';
export { TelegramDestinationsService } from './notification/telegram-destinations-service.js';
export { InMemoryProfileRepository } from './profiles/in-memory-profile-repository.js';
export { MongoProfileRepository } from './profiles/mongo-profile-repository.js';
export { type IndicatorInstanceInput, ProfileService } from './profiles/profile-service.js';
export type { ProfileServiceOptions } from './profiles/profile-service.types.js';
export { ActionRunner } from './rules/action-runner.js';
export { CandleRuleEventBridge } from './rules/candle-rule-event-bridge.js';
export { handleCascadeError } from './rules/cascade-error-handler.js';
export { evaluateCondition } from './rules/condition-evaluator.js';
export { CycleGuard, CycleOverflowError } from './rules/cycle-guard.js';
export { buildEvaluationContext } from './rules/evaluation-context.js';
export type { EvaluationContext, EvaluationLookups } from './rules/evaluation-context.types.js';
export { InMemoryEventLog } from './rules/in-memory-event-log.js';
export { InMemoryFiringStateRepository } from './rules/in-memory-firing-state-repository.js';
export { InMemoryNotifier, type SentMessage } from './rules/in-memory-notifier.js';
export { InMemoryRuleRepository } from './rules/in-memory-rule-repository.js';
export { IndicatorRuleEventBridge } from './rules/indicator-rule-event-bridge.js';
export { LiveEvaluationLookups } from './rules/live-evaluation-lookups.js';
export { MinuteTimerSource } from './rules/minute-timer-source.js';
export { MongoEventLog } from './rules/mongo-event-log.js';
export { MongoFiringStateRepository } from './rules/mongo-firing-state-repository.js';
export { MongoRuleRepository } from './rules/mongo-rule-repository.js';
export { type PrevCurrent, PrevCurrentCache } from './rules/prev-current-cache.js';
export { QuoteRuleEventBridge } from './rules/quote-rule-event-bridge.js';
export {
  RuleOrchestrator,
  type RuleOrchestratorOptions,
} from './rules/rule-orchestrator.js';
export {
  type RuleCreateInput,
  RuleService,
  type RuleServiceOptions,
} from './rules/rule-service.js';
export {
  TelegramNotifier,
  type TelegramNotifierOptions,
  TelegramSendError,
} from './rules/telegram-notifier.js';
export { TriggerEvaluator } from './rules/trigger-evaluator.js';
export {
  type RuleEngineDeps,
  type WiredRuleEngine,
  wireRuleEngine,
} from './rules/wire-rule-engine.js';
export * as RulesV2 from './rules-v2/index.js';
// Flat re-exports of the v2 application + wire surface so the API layer can
// import them without prefixing — keeps controllers' `import { ... }` flat
// and matches v1's `RuleService` / `wireRuleEngine` precedent.
export {
  type EventListOptions as RuleV2EventListOptions,
  RuleServiceV2,
  type RuleServiceV2Options,
  type RuleV2CreateInput,
  type RuleV2ListFilters,
} from './rules-v2/service/index.js';
export {
  feedCandleIntoEngineV2,
  LiveEvaluationLookupsV2,
  type RuleEngineV2Deps,
  type WiredRuleEngineV2,
  wireRuleEngineV2,
} from './rules-v2/wire/index.js';
export { loadSettings } from './settings.js';
export type { LogLevel, Settings, TelegramDestination } from './settings.types.js';
export { InMemoryStateRepository } from './state/in-memory-state-repository.js';
export { MongoStateRepository } from './state/mongo-state-repository.js';
export { BinanceMarketDataSource } from './symbols/binance-market-data-source.js';
export { defaultMarketDataSources } from './symbols/default-sources.js';
export {
  type CandleSeed,
  InMemoryMarketDataSource,
} from './symbols/in-memory-market-data-source.js';
export { InMemoryWatchlistRepository } from './symbols/in-memory-watchlist-repository.js';
export { MongoWatchlistRepository } from './symbols/mongo-watchlist-repository.js';
export {
  QuoteStreamService,
  type QuoteStreamServiceOptions,
  type QuoteSubscriptionResult,
} from './symbols/quote-stream-service.js';
export { SymbolService } from './symbols/symbol-service.js';
export { YahooMarketDataSource } from './symbols/yahoo-market-data-source.js';
