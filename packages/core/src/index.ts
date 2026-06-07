/**
 * Public surface of `@lametrader/core` — the pure domain layer.
 *
 * Holds entities and contracts (ports) only: no I/O, no outward imports.
 */

export {
  CandleError,
  DEFAULT_CANDLE_LIMIT,
  MAX_CANDLE_LIMIT,
  parseBackfillRange,
  parseCandleLimit,
} from './candle.js';
export type {
  BackfillRange,
  BaseCandle,
  Candle,
  CandlePage,
  CandleRepository,
  CryptoCandle,
  EquityCandle,
  FxCandle,
} from './candle.types.js';
export { ConfigError, defaultConfig, mergeConfig, parseConfig } from './config.js';
export { type Config, type ConfigRepository, Period } from './config.types.js';
export {
  MarketDataError,
  parseSymbolPeriods,
  SymbolConflictError,
  SymbolError,
  SymbolNotFoundError,
  symbolType,
} from './symbol.js';
export {
  type Instrument,
  type MarketDataSource,
  SymbolType,
  type WatchedSymbol,
  type WatchlistRepository,
} from './symbol.types.js';
