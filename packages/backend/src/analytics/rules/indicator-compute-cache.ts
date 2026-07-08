import type { IndicatorComputeResult } from '@lametrader/core';
import type {
  IndicatorComputeCache,
  IndicatorComputeKey,
} from './indicator-compute-cache.types.js';

/**
 * Field separator for the serialized compute key.
 *
 * `NUL` never appears in a symbol id, indicator key, period, numeric bound, or
 * the JSON of an inputs record, so joining the fields on it makes the string
 * identity unambiguous — two different tuples can never collide into one key.
 */
const KEY_SEPARATOR = '\u0000';

/**
 * Create a fresh, empty {@link IndicatorComputeCache} for one observation.
 *
 * Memoizes the compute *promise* (not just the settled value) so events that
 * resolve the same operand concurrently within the batch still share the single
 * in-flight read. The lifetime is exactly one batch: the caller drops the
 * instance when the batch drains, so nothing survives to leak into the next bar
 * — and because {@link IndicatorComputeKey} carries the advancing window, the
 * next bar keys a different entry regardless.
 */
export function createIndicatorComputeCache(): IndicatorComputeCache {
  const memo = new Map<string, Promise<IndicatorComputeResult>>();
  return {
    compute(key, load) {
      const cacheKey = serializeComputeKey(key);
      const existing = memo.get(cacheKey);
      if (existing !== undefined) return existing;
      const pending = load();
      memo.set(cacheKey, pending);
      return pending;
    },
  };
}

/**
 * Default entry cap for {@link createRunScopedIndicatorComputeCache}.
 *
 * The live working set is tiny — one entry per (indicator operand × page
 * window) read across two adjacent observations — so 256 is generous headroom
 * while keeping the cache constant-size over an arbitrarily long run:
 * fine-period operand keys legitimately churn once per fine bar and age out.
 */
const RUN_SCOPED_COMPUTE_CACHE_MAX_ENTRIES = 256;

/**
 * Create a **run-scoped** {@link IndicatorComputeCache} — the same typed-key
 * memo as {@link createIndicatorComputeCache}, with no batch boundary: entries
 * survive across observations for the lifetime of the instance (ADR-0022,
 * #556).
 *
 * The change-detection predicate is the key itself: the pager derives each
 * compute window from the operand's newest *visible* candle page, so a
 * coarse-period operand keys identically across every fine observation within
 * a coarse span and re-keys exactly when a new coarse bar becomes visible —
 * identical key ⇒ memo hit ⇒ no recompute.
 *
 * Sound **only when the candles behind every key are immutable for the cache's
 * lifetime** (a backtest replay reads closed historical bars and never
 * writes); the live path re-saves the forming bar under the same time and
 * backfill upserts history, so it must keep the per-observation cache instead.
 *
 * Two behaviours the per-observation cache doesn't need:
 *
 * - **Bounded LRU** — a hit re-inserts its entry (refreshing recency) and an
 *   insert beyond `maxEntries` evicts oldest-first, so fine-period keys that
 *   churn once per bar cannot grow the cache over a long run.
 * - **Rejections evicted on settlement** — a failed compute is dropped from
 *   the memo, so the next observation retries it exactly as the
 *   per-observation lifetime would, instead of replaying one transient failure
 *   for the rest of the run.
 *
 * @param maxEntries - LRU capacity; defaults to
 *   {@link RUN_SCOPED_COMPUTE_CACHE_MAX_ENTRIES}.
 */
export function createRunScopedIndicatorComputeCache(
  maxEntries: number = RUN_SCOPED_COMPUTE_CACHE_MAX_ENTRIES,
): IndicatorComputeCache {
  const memo = new Map<string, Promise<IndicatorComputeResult>>();
  return {
    compute(key, load) {
      const cacheKey = serializeComputeKey(key);
      const existing = memo.get(cacheKey);
      if (existing !== undefined) {
        // Re-insert on hit so Map iteration order doubles as LRU recency.
        memo.delete(cacheKey);
        memo.set(cacheKey, existing);
        return existing;
      }
      const pending = load();
      memo.set(cacheKey, pending);
      pending.catch(() => {
        // Evict the rejection (only if this promise still owns the slot) so
        // the identity is retried on its next read rather than poisoned.
        if (memo.get(cacheKey) === pending) memo.delete(cacheKey);
      });
      while (memo.size > maxEntries) {
        const oldest = memo.keys().next().value;
        if (oldest === undefined) break;
        memo.delete(oldest);
      }
      return pending;
    },
  };
}

/**
 * Serialize an {@link IndicatorComputeKey} into a stable string identity.
 *
 * The scalar fields are joined explicitly on {@link KEY_SEPARATOR}, and the
 * inputs record is normalized to sorted `[key, value]` pairs so key order never
 * changes the identity — a narrow, checkable expression of the compute identity
 * rather than an opaque dump of the raw argument list.
 */
function serializeComputeKey(key: IndicatorComputeKey): string {
  return [
    key.symbolId,
    key.period,
    key.indicatorKey,
    String(key.from),
    String(key.to),
    serializeInputs(key.inputs),
  ].join(KEY_SEPARATOR);
}

/** Deterministic JSON for an inputs record — sorted keys, so order is irrelevant. */
function serializeInputs(inputs: Record<string, unknown>): string {
  const pairs = Object.keys(inputs)
    .sort()
    .map((k) => [k, inputs[k]] as const);
  return JSON.stringify(pairs);
}
