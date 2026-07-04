/**
 * DI token for the {@link CandleRepository} port.
 *
 * The port is a `@lametrader/core` interface, so it has no runtime value to
 * inject by type; this string token binds the interface to its concrete provider
 * (the Mongoose adapter in production, an in-memory fake under a Nest DI override
 * in tests).
 *
 * Owned and bound exactly once by
 * {@link import('./candles.module.js').CandlesModule}, which registers the single
 * `candles`-collection model and exports this token — the shared-persistence
 * pattern. Every feature that needs candles imports that module rather than
 * newing up its own store: the candles resource (reads / backfill / polling) and
 * the symbols use-case (`GET /symbols?enrich=true` quotes + the remove-symbol
 * candle cascade).
 */
export const CANDLE_REPOSITORY = 'CANDLE_REPOSITORY';
