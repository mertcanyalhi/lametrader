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
export { ConfigError, defaultConfig, mergeConfig, parseConfig } from './config.js';
export { type Config, type ConfigRepository, Period } from './config.types.js';
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
  type Profile,
  type ProfileFields,
  type ProfileRepository,
  ProfileScope,
  type ProfileScopeSpec,
  type SymbolsScope,
} from './profile.types.js';
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
