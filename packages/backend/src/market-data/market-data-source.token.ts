/**
 * DI token for the registered market-data sources — the `MarketDataSource[]`
 * the symbols use-case (and, later, backfill/polling) fans discovery and candle
 * fetches out across.
 *
 * `MarketDataSource` is a `@lametrader/core` interface with no runtime value to
 * inject by type; this string token binds the concrete provider set (the default
 * Binance + Yahoo sources in production, an in-memory stub under a Nest DI
 * override in tests).
 */
export const MARKET_DATA_SOURCES = 'MARKET_DATA_SOURCES';
