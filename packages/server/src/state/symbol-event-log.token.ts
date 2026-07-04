/**
 * DI token for the {@link import('./symbol-event-log.types.js').SymbolEventLog}
 * read port.
 *
 * The port is a plain interface, so it has no runtime value to inject by type;
 * this string token binds it to its concrete provider (the Mongoose adapter
 * reading the `watchlist` document's embedded `events` array in production, an
 * in-memory fake under a Nest DI override in tests), and the state-history
 * service is wired against it.
 */
export const SYMBOL_EVENT_LOG = 'SYMBOL_EVENT_LOG';
