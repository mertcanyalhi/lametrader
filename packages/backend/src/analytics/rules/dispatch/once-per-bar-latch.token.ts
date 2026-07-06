/**
 * DI token for the {@link import('./once-per-bar-latch.types.js').OncePerBarLatchStore} port.
 *
 * The port is a plain TypeScript interface, so it has no runtime value to inject
 * by type; this string token binds it to its concrete provider — the Redis
 * adapter in production, an in-memory fake under a Nest DI override in tests.
 *
 * Owned and bound exactly once by
 * {@link import('../../analytics.module.js').AnalyticsModule} (which also
 * constructs the shared Redis client): the relocated rule engine's dispatcher is
 * the only consumer, so the store lives in the context that uses it rather than
 * the shared `CommonModule` leaf.
 */
export const ONCE_PER_BAR_LATCH_STORE = 'ONCE_PER_BAR_LATCH_STORE';
