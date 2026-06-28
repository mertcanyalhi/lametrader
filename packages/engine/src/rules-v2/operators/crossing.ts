import { RulesV2, type StateValue, StateValueType } from '@lametrader/core';

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
export function evaluateCrossing(
  leaf: RulesV2.CrossingLeafCondition,
  ctx: EvaluationContext,
): boolean {
  const leftSeries = ctx.resolveSeries(leaf.left);
  if (leftSeries.length === 0) return false;
  const rightSeries = ctx.resolveSeries(leaf.right);
  if (rightSeries.length === 0) return false;

  const walker = leftSeries.backwardWalk();
  const newestLeft = walker.next();
  if (newestLeft.done) return false;
  const newestLeftValue = numericPoint(newestLeft.value.value);
  if (newestLeftValue === null) return false;
  const newestRight = numericAsOf(rightSeries, newestLeft.value.ts);
  if (newestRight === null) return false;
  const currentSide = Math.sign(newestLeftValue - newestRight);
  if (currentSide === 0) return false;

  let baselineSide = 0;
  for (const point of walker) {
    const lv = numericPoint(point.value);
    if (lv === null) continue;
    const rv = numericAsOf(rightSeries, point.ts);
    if (rv === null) continue;
    const diff = lv - rv;
    if (diff === 0) continue;
    baselineSide = Math.sign(diff);
    break;
  }
  if (baselineSide === 0 || baselineSide === currentSide) return false;

  switch (leaf.operator) {
    case RulesV2.CrossingOperator.CrossingUp:
      return currentSide > 0;
    case RulesV2.CrossingOperator.CrossingDown:
      return currentSide < 0;
    case RulesV2.CrossingOperator.Crossing:
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
function numericAsOf(series: SeriesView, ts: number): number | null {
  const point = series.asOf(ts);
  if (point === null) return null;
  return numericPoint(point.value);
}
