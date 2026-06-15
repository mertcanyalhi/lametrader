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
export { MongoConfigRepository } from './config/mongo-config-repository.js';
export { type ConnectedServices, type ConnectOptions, connectServices } from './connect.js';
export { defaultIndicators } from './indicators/default-indicators.js';
export { type DefineIndicatorSpec, defineIndicator } from './indicators/define-indicator.js';
export { IndicatorRegistry } from './indicators/indicator-registry.js';
export { movingAverage } from './indicators/sma.js';
export { volumeWeightedMovingAverage } from './indicators/vwma.js';
export { InMemoryProfileRepository } from './profiles/in-memory-profile-repository.js';
export { MongoProfileRepository } from './profiles/mongo-profile-repository.js';
export { ProfileService } from './profiles/profile-service.js';
export type { ProfileServiceOptions } from './profiles/profile-service.types.js';
export { loadSettings } from './settings.js';
export type { Settings } from './settings.types.js';
export { BinanceMarketDataSource } from './symbols/binance-market-data-source.js';
export { defaultMarketDataSources } from './symbols/default-sources.js';
export {
  type CandleSeed,
  InMemoryMarketDataSource,
} from './symbols/in-memory-market-data-source.js';
export { InMemoryWatchlistRepository } from './symbols/in-memory-watchlist-repository.js';
export { MongoWatchlistRepository } from './symbols/mongo-watchlist-repository.js';
export { SymbolService } from './symbols/symbol-service.js';
export { YahooMarketDataSource } from './symbols/yahoo-market-data-source.js';
