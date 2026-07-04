/**
 * DI token for the {@link StateRepository} port.
 *
 * The port is a `@lametrader/core` interface, so it has no runtime value to
 * inject by type; this string token binds the interface to its concrete provider
 * (the Mongoose adapter in production, an in-memory fake under a Nest DI override
 * in tests).
 *
 * Owned and bound exactly once by
 * {@link import('./state.module.js').StateModule}, which registers the single
 * `state`-collection model and exports this token — the shared-persistence
 * pattern (mirroring the watchlist / candles modules). The rule-engine writes
 * state through the orchestrator; the state resource only reads it back.
 */
export const STATE_REPOSITORY = 'STATE_REPOSITORY';
