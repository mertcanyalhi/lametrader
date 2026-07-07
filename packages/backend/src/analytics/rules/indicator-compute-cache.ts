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
