/**
 * DI token for the full {@link import('@lametrader/core').EventLog} port — the
 * shared, mirrored rule-event log (ADR-0014).
 *
 * The port is a `@lametrader/core` interface, so it has no runtime value to
 * inject by type; this string token binds it to its concrete provider (the
 * Mongoose adapter over the embedded `events[]` arrays in production, an
 * in-memory fake under a Nest DI override in tests).
 *
 * Owned and bound exactly once by
 * {@link import('./event-log.module.js').EventLogModule}, which registers the
 * single model over the `rules` collection's `events[]` and the single model over
 * the `watchlist` collection's `events[]`, then exports this token — the
 * shared-persistence pattern. The rules resource (orchestrator + `RuleService`)
 * appends and reads through it; the state resource consumes the narrow
 * {@link import('./symbol-event-log.token.js').SYMBOL_EVENT_LOG} view of the same
 * instance.
 */
export const EVENT_LOG = 'EVENT_LOG';
