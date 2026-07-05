import {
  type CrossingLeafCondition,
  CrossingOperator,
  type StateValue,
  StateValueType,
} from '@lametrader/core';

import type { EvaluationContext } from '../evaluation-context.types.js';
import type { SeriesView } from '../series.types.js';

/**
 * Evaluate a series-aware crossing leaf under lookback-past-flats semantics
 * (per ADR 0016 / CONTEXT.md).
 *
 * Walks the left operand's native timeline newest → oldest via
 * {@link SeriesView.backwardWalk}.
 * The right operand is resampled at each left timestamp via {@link SeriesView.asOf}
 * (step function between updates) — so a tick-left × bar-right walk produces the
 * same verdict regardless of how often the right operand updates.
 *
 * The current side is the sign of `(latestLeft - rightAt(latestLeft.ts))`;
 * `0` (sitting on the boundary) returns `false`.
 * The baseline side is the sign of the first non-flat older point;
 * points where `left === right` are skipped.
 * Fires when `currentSide` differs from `baselineSide` (further gated by
 * `CrossingUp` / `CrossingDown` direction).
 *
 * Returns `false` for empty left series, missing right resolution, no baseline
 * found, or any other "no data yet" branch — never throws.
 */
export async function evaluateCrossing(
  leaf: CrossingLeafCondition,
  ctx: EvaluationContext,
): Promise<boolean> {
  const leftSeries = ctx.resolveSeries(leaf.left, leaf.interval);
  const rightSeries = ctx.resolveSeries(leaf.right, leaf.interval);

  // An empty left series ends the walk immediately (`newestLeft.done`); an empty
  // right series resolves `asOf` to `null` below — both short-circuit to `false`
  // without asking the lazy series for a length.
  const walker = leftSeries.backwardWalk();
  const newestLeft = await walker.next();
  if (newestLeft.done) return false;
  const newestLeftValue = numericPoint(newestLeft.value.value);
  if (newestLeftValue === null) return false;
  const newestRight = await numericAsOf(rightSeries, newestLeft.value.ts);
  if (newestRight === null) return false;
  const currentSide = Math.sign(newestLeftValue - newestRight);
  if (currentSide === 0) return false;

  let baselineSide = 0;
  for await (const point of walker) {
    const lv = numericPoint(point.value);
    if (lv === null) continue;
    const rv = await numericAsOf(rightSeries, point.ts);
    if (rv === null) continue;
    const diff = lv - rv;
    if (diff === 0) continue;
    baselineSide = Math.sign(diff);
    break;
  }
  if (baselineSide === 0 || baselineSide === currentSide) return false;

  switch (leaf.operator) {
    case CrossingOperator.CrossingUp:
      return currentSide > 0;
    case CrossingOperator.CrossingDown:
      return currentSide < 0;
    case CrossingOperator.Crossing:
      return true;
  }
}

/**
 * Unwrap a {@link StateValue} to a numeric value, or `null` if it isn't a
 * finite Number — short-circuits the operator to `false` rather than throwing.
 */
function numericPoint(value: StateValue): number | null {
  if (value.type !== StateValueType.Number) return null;
  if (Number.isNaN(value.value)) return null;
  return value.value;
}

/**
 * `asOf` lookup on a series that unwraps to a number or `null`.
 * Combines the step-function resampling with the StateValue → number guard.
 */
async function numericAsOf(series: SeriesView, ts: number): Promise<number | null> {
  const point = await series.asOf(ts);
  if (point === null) return null;
  return numericPoint(point.value);
}
