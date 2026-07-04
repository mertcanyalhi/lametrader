/**
 * DI token for the {@link WatchlistRepository} port.
 *
 * The port is a `@lametrader/core` interface, so it has no runtime value to
 * inject by type; this string token binds the interface to its concrete provider
 * (the Mongoose adapter in production, an in-memory fake under a Nest DI override
 * in tests).
 */
export const WATCHLIST_REPOSITORY = 'WATCHLIST_REPOSITORY';
