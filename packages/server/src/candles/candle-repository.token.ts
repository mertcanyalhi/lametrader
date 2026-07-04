/**
 * DI token for the {@link CandleRepository} port.
 *
 * The port is a `@lametrader/core` interface, so it has no runtime value to
 * inject by type; this string token binds the interface to its concrete
 * provider.
 *
 * The candles resource (backfill / reads / polling) is ported in a later stage
 * (#485), which brings the Mongoose-backed adapter and rebinds this token. Until
 * then the only consumer is the symbols use-case — `GET /symbols?enrich=true`
 * (reads the latest candles for a quote) and the remove-symbol cascade
 * (`deleteSymbol`) — and no route persists candles into this server yet, so the
 * in-memory adapter is the honest stand-in (empty store → null quotes, no-op
 * cascade), swapped for Mongo when candle persistence lands as a unit.
 */
export const CANDLE_REPOSITORY = 'CANDLE_REPOSITORY';
