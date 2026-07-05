import {
  type ChannelLeafCondition,
  ChannelOperator,
  type StateValue,
  StateValueType,
} from '@lametrader/core';

import type { EvaluationContext } from '../evaluation-context.types.js';
import type { SeriesView } from '../series.types.js';

/**
 * Evaluate a ternary series-aware channel leaf — `Entering` / `Exiting` /
 * `Inside`.
 *
 * `InsideChannel` is a strict snapshot test: `lower < latest < upper`.
 * `EnteringChannel` / `ExitingChannel` walk the left's native timeline
 * (newest → oldest via {@link SeriesView.backwardWalk}) skipping points sitting
 * on either boundary, then test:
 * - `Entering`: latest is strictly inside the channel AND the first
 *   off-boundary baseline going back was strictly outside.
 * - `Exiting`: latest is strictly outside the channel AND the first
 *   off-boundary baseline going back was strictly inside.
 *
 * Bounds are resampled via `asOf` at each left timestamp (same step-function
 * shape crossing uses), so cross-frequency bounds (dynamic envelope from an
 * indicator) and constant bounds (literal numbers) plug in interchangeably.
 *
 * Returns `false` (never throws) for empty series, missing bound resolution,
 * or no off-boundary baseline found.
 */
export async function evaluateChannel(
  leaf: ChannelLeafCondition,
  ctx: EvaluationContext,
): Promise<boolean> {
  const leftSeries = ctx.resolveSeries(leaf.left, leaf.interval);
  const lowerSeries = ctx.resolveSeries(leaf.lower, leaf.interval);
  const upperSeries = ctx.resolveSeries(leaf.upper, leaf.interval);

  // An empty left series ends the walk immediately (`newest.done`); an empty
  // bound series resolves `asOf` to `null` below — both short-circuit to
  // `false` without a cheap length up front.
  const walker = leftSeries.backwardWalk();
  const newest = await walker.next();
  if (newest.done) return false;
  const newestValue = numericPoint(newest.value.value);
  if (newestValue === null) return false;
  const newestLower = await numericAsOf(lowerSeries, newest.value.ts);
  const newestUpper = await numericAsOf(upperSeries, newest.value.ts);
  if (newestLower === null || newestUpper === null) return false;

  if (leaf.operator === ChannelOperator.InsideChannel) {
    return newestValue > newestLower && newestValue < newestUpper;
  }

  const currentStrictlyOutside = newestValue < newestLower || newestValue > newestUpper;
  const currentStrictlyInside = newestValue > newestLower && newestValue < newestUpper;
  if (leaf.operator === ChannelOperator.EnteringChannel && !currentStrictlyInside) {
    return false;
  }
  if (leaf.operator === ChannelOperator.ExitingChannel && !currentStrictlyOutside) {
    return false;
  }

  let baselineStrictlyOutside = false;
  let baselineStrictlyInside = false;
  let baselineFound = false;
  for await (const point of walker) {
    const lv = numericPoint(point.value);
    if (lv === null) continue;
    const lo = await numericAsOf(lowerSeries, point.ts);
    const up = await numericAsOf(upperSeries, point.ts);
    if (lo === null || up === null) continue;
    if (lv === lo || lv === up) continue;
    baselineStrictlyOutside = lv < lo || lv > up;
    baselineStrictlyInside = lv > lo && lv < up;
    baselineFound = true;
    break;
  }
  if (!baselineFound) return false;

  switch (leaf.operator) {
    case ChannelOperator.EnteringChannel:
      return baselineStrictlyOutside;
    case ChannelOperator.ExitingChannel:
      return baselineStrictlyInside;
  }
}

/**
 * Unwrap a {@link StateValue} to a numeric value, or `null` if it isn't a
 * finite Number.
 */
function numericPoint(value: StateValue): number | null {
  if (value.type !== StateValueType.Number) return null;
  if (Number.isNaN(value.value)) return null;
  return value.value;
}

/** `asOf` lookup on a series that unwraps to a number or `null`. */
async function numericAsOf(series: SeriesView, ts: number): Promise<number | null> {
  const point = await series.asOf(ts);
  if (point === null) return null;
  return numericPoint(point.value);
}
