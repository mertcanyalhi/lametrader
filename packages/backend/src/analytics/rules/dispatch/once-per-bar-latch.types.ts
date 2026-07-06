import type { Period } from '@lametrader/core';

/**
 * Driven port for the `OncePerBar` gate's latch, persisted **out-of-process**
 * so it survives a restart and is shared across backend instances (issue #513,
 * ADR-0020).
 *
 * Presence of a `(ruleId, symbolId, period)` entry means "this rule has already
 * fired within the current bar window on that symbol" — the gate suppresses
 * repeats while the entry exists.
 * An entry is created on fire ({@link latch}), read on the gate check
 * ({@link isLatched}), and cleared for a `(symbol, period)` on an explicit
 * `BarOpened` re-arm ({@link rearm}).
 * Each entry also carries a TTL as a backstop (see {@link latch}) so a missed
 * `BarOpened` or a crashed instance can never wedge a latch permanently.
 *
 * Implemented by the Redis adapter (`RedisOncePerBarLatchStore`) in production
 * and an in-memory fake (`InMemoryOncePerBarLatchStore`) that backs the unit
 * tier — the two are proven behaviour-identical by the shared
 * `runOncePerBarLatchStoreContract` suite.
 */
export interface OncePerBarLatchStore {
  /**
   * Whether the `(ruleId, symbolId, period)` latch is currently set — the gate
   * check that replaces the old in-memory `Set.has`.
   */
  isLatched(ruleId: string, symbolId: string, period: Period): Promise<boolean>;
  /**
   * Record a fire: set the `(ruleId, symbolId, period)` latch with a TTL of
   * `ttlMs` (the dispatcher passes `periodMillis(period) * 2` — ~one bar plus
   * slop). Idempotent: re-latching an already-set key is a no-op. Replaces the
   * old in-memory `Set.add`.
   */
  latch(ruleId: string, symbolId: string, period: Period, ttlMs: number): Promise<void>;
  /**
   * Re-arm on `BarOpened(symbolId, period)`: clear every latch for that
   * `(symbolId, period)` across all rules, so the next matching tick can fire
   * again. Replaces the old in-memory suffix-match sweep. Scoped to the one
   * `(symbol, period)` — a `BarOpened` for one symbol never re-arms another's
   * latch of the same period.
   */
  rearm(symbolId: string, period: Period): Promise<void>;
}
