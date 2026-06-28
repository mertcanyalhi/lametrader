import { RulesV2, type StateValue, StateValueType } from '@lametrader/core';

import type { EvaluationContext } from '../evaluation-context.types.js';
import type { SeriesView } from '../series.types.js';

/**
 * Evaluate a ternary series-aware channel leaf — `Entering` / `Exiting` /
 * `Inside`.
 *
 * `InsideChannel` is a snapshot test: latest left within `[lower, upper]`.
 * `EnteringChannel` / `ExitingChannel` walk the left's native timeline
 * skipping points sitting on either boundary, then test:
 * - `Entering`: latest is NOT strictly outside (inside or on boundary) AND
 *   the first off-boundary baseline going back was strictly outside.
 * - `Exiting`: latest is NOT strictly inside (outside or on boundary) AND
 *   the first off-boundary baseline going back was strictly inside.
 *
 * Bounds are resampled via `asOf` at each left timestamp (same step-function
 * shape crossing uses), so cross-frequency bounds (dynamic envelope from an
 * indicator) and constant bounds (literal numbers) plug in interchangeably.
 *
 * Returns `false` (never throws) for missing series, missing bounds, or no
 * off-boundary baseline found.
 */
export function evaluateChannel(
  leaf: RulesV2.ChannelLeafCondition,
  ctx: EvaluationContext,
): boolean {
  const leftSeries = ctx.resolveSeries(leaf.left);
  if (leftSeries === null) return false;
  const leftSamples = leftSeries.samples();
  if (leftSamples.length === 0) return false;
  const lowerAt = boundResolver(leaf.lower, ctx);
  const upperAt = boundResolver(leaf.upper, ctx);
  const newest = leftSamples[leftSamples.length - 1];
  if (newest === undefined) return false;
  const newestLower = lowerAt(newest.ts);
  const newestUpper = upperAt(newest.ts);
  if (newestLower === null || newestUpper === null) return false;
  if (leaf.operator === RulesV2.ChannelOperator.InsideChannel) {
    return newest.value >= newestLower && newest.value <= newestUpper;
  }
  const currentStrictlyOutside = newest.value < newestLower || newest.value > newestUpper;
  const currentStrictlyInside = newest.value > newestLower && newest.value < newestUpper;
  if (leaf.operator === RulesV2.ChannelOperator.EnteringChannel && currentStrictlyOutside) {
    return false;
  }
  if (leaf.operator === RulesV2.ChannelOperator.ExitingChannel && currentStrictlyInside) {
    return false;
  }
  let baselineStrictlyOutside = false;
  let baselineStrictlyInside = false;
  let baselineFound = false;
  for (let i = leftSamples.length - 2; i >= 0; i--) {
    const ls = leftSamples[i];
    if (ls === undefined) continue;
    const lo = lowerAt(ls.ts);
    const up = upperAt(ls.ts);
    if (lo === null || up === null) continue;
    if (ls.value === lo || ls.value === up) continue;
    baselineStrictlyOutside = ls.value < lo || ls.value > up;
    baselineStrictlyInside = ls.value > lo && ls.value < up;
    baselineFound = true;
    break;
  }
  if (!baselineFound) return false;
  switch (leaf.operator) {
    case RulesV2.ChannelOperator.EnteringChannel:
      return baselineStrictlyOutside;
    case RulesV2.ChannelOperator.ExitingChannel:
      return baselineStrictlyInside;
  }
}

/**
 * Build a `(ts) → number | null` resolver for a channel bound operand
 * (constant or series).
 */
function boundResolver(
  operand: RulesV2.ConditionOperand,
  ctx: EvaluationContext,
): (ts: number) => number | null {
  const series = ctx.resolveSeries(operand);
  if (series !== null) return (ts) => sampleNumber(series, ts);
  const latest = asNumber(ctx.resolveLatest(operand));
  return () => latest;
}

/** `asOf` lookup that unwraps to a number or `null`. */
function sampleNumber(series: SeriesView, ts: number): number | null {
  const sample = series.asOf(ts);
  if (sample === null) return null;
  if (Number.isNaN(sample.value)) return null;
  return sample.value;
}

/**
 * Unwrap a `Number` {@link StateValue} for the constant-bound branch; returns
 * `null` for non-Number / NaN / null so the resolver short-circuits.
 */
function asNumber(value: StateValue | null): number | null {
  if (value === null) return null;
  if (value.type !== StateValueType.Number) return null;
  if (Number.isNaN(value.value)) return null;
  return value.value;
}
