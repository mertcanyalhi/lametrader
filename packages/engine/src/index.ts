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
export { InMemoryNotifier, type SentMessage } from './notification/in-memory-notifier.js';
export { TelegramDestinationsService } from './notification/telegram-destinations-service.js';
export {
  TelegramNotifier,
  type TelegramNotifierOptions,
  TelegramSendError,
} from './notification/telegram-notifier.js';
export { InMemoryProfileRepository } from './profiles/in-memory-profile-repository.js';
export { MongoProfileRepository } from './profiles/mongo-profile-repository.js';
export { type IndicatorInstanceInput, ProfileService } from './profiles/profile-service.js';
export type { ProfileServiceOptions } from './profiles/profile-service.types.js';
export { type BarAxis, BarSeriesView } from './rules/bar-series-view.js';
export {
  BarLifecycleBridge,
  IndicatorCascadeBridge,
  StateCascadeBridge,
  TickBridge,
} from './rules/bridges/index.js';
export {
  type DispatchOptions,
  evaluateCondition,
  type FireRecord,
  InMemoryRuleRepository,
  type IntervalEmit,
  IntervalScheduler,
  MongoRuleRepository,
  type RuleDocument,
  referencesSlot,
  routes,
  TriggerDispatcher,
  type TriggerDispatcherDeps,
} from './rules/dispatch/index.js';
export {
  barSeriesKey,
  buildEvaluationContext,
  type EvaluationContextDeps,
  prewarmBarSeries,
} from './rules/evaluation-context.js';
export type { EvaluationContext } from './rules/evaluation-context.types.js';
export {
  ArraySeriesView,
  IndicatorSeriesStore,
  type IndicatorWarmupRequest,
} from './rules/indicator-series-store.js';
export {
  evaluateChannel,
  evaluateComparison,
  evaluateCrossing,
  evaluateLeaf,
  evaluateMoving,
  evaluateState,
} from './rules/operators/index.js';
export {
  ActionRunner,
  CycleGuard,
  CycleOverflowError,
  createPerSymbolSerializer,
  InMemoryEventLog,
  MongoEventLog,
  RuleOrchestrator,
  type RuleOrchestratorDeps,
  type RuleOrchestratorOptions,
  RuleOutcome,
} from './rules/orchestrator/index.js';
export type { SeriesPoint, SeriesView } from './rules/series.types.js';
export {
  type EventListOptions as RuleEventListOptions,
  type RuleCreateInput,
  type RuleListFilters,
  RuleService,
  type RuleServiceOptions,
} from './rules/service/index.js';
export { TICK_RING_CAPACITY, TickRing } from './rules/tick-ring.js';
export {
  feedCandleIntoEngine,
  type InitialStateEntry,
  LiveEvaluationLookups,
  type RuleEngineDeps,
  type WiredRuleEngine,
  wireRuleEngine,
} from './rules/wire/index.js';
export { loadSettings } from './settings.js';
export type { LogLevel, Settings, TelegramDestination } from './settings.types.js';
export { InMemoryStateRepository } from './state/in-memory-state-repository.js';
export { MongoStateRepository } from './state/mongo-state-repository.js';
export { StateHistoryService } from './state/state-history-service.js';
export type {
  StateHistoryEntry,
  StateHistoryWindow,
  StateKeyDescriptor,
} from './state/state-history-service.types.js';
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
