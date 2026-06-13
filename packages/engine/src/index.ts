/**
 * Public surface of `@lametrader/engine` — the application layer.
 *
 * Orchestrates use-cases by wiring `core` ports to driven adapters.
 */
export { BackfillService } from './candles/backfill-service.js';
export type {
  BackfillProgress,
  BackfillProgressListener,
  BackfillSummary,
} from './candles/backfill-service.types.js';
export { connectBackfillService } from './candles/connect.js';
export { InMemoryCandleRepository } from './candles/in-memory-candle-repository.js';
export { MongoCandleRepository } from './candles/mongo-candle-repository.js';
export { PollingService } from './candles/polling-service.js';
export type {
  CandleEvent,
  CandleListener,
  PollingOptions,
} from './candles/polling-service.types.js';
export { ConfigService } from './config/config-service.js';
export { connectConfigService } from './config/connect.js';
export { MongoConfigRepository } from './config/mongo-config-repository.js';
export { type ConnectOptions, connectServices } from './connect.js';
export { loadSettings } from './settings.js';
export type { Settings } from './settings.types.js';
export { BinanceMarketDataSource } from './symbols/binance-market-data-source.js';
export { connectSymbolService } from './symbols/connect.js';
export {
  type CandleSeed,
  InMemoryMarketDataSource,
} from './symbols/in-memory-market-data-source.js';
export { InMemoryWatchlistRepository } from './symbols/in-memory-watchlist-repository.js';
export { MongoWatchlistRepository } from './symbols/mongo-watchlist-repository.js';
export { SymbolService } from './symbols/symbol-service.js';
export { YahooMarketDataSource } from './symbols/yahoo-market-data-source.js';
