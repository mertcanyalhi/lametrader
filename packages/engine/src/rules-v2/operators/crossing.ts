import { RulesV2, type StateValue, StateValueType } from '@lametrader/core';

import type { EvaluationContext } from '../evaluation-context.types.js';
import type { SeriesView } from '../series.types.js';

/**
 * Evaluate a series-aware crossing leaf under lookback-past-flats semantics
 * (per ADR 0016 / CONTEXT.md).
 *
 * Walks the left operand's native timeline newest → oldest.
 * The right operand is resampled at each left timestamp via `asOf` (step
 * function between updates) — so a tick-left × bar-right walk produces the
 * same verdict regardless of how often the right operand updates.
 *
 * The current side is the sign of `(latestLeft - rightAt(latestLeft.ts))`;
 * `0` (sitting on the boundary) returns `false`.
 * The baseline side is the sign of the first non-flat older point;
 * points where `left === right` are skipped.
 * Fires when `currentSide` differs from `baselineSide` (further gated by
 * `CrossingUp` / `CrossingDown` direction).
 *
 * Returns `false` for empty / `null` left series, no baseline found, or
 * any other "no data yet" branch — never throws.
 */
export function evaluateCrossing(
  leaf: RulesV2.CrossingLeafCondition,
  ctx: EvaluationContext,
): boolean {
  const leftSeries = ctx.resolveSeries(leaf.left);
  if (leftSeries === null) return false;
  const leftSamples = leftSeries.samples();
  if (leftSamples.length === 0) return false;
  const rightAt = rightResolver(leaf.right, ctx);
  const newestLeft = leftSamples[leftSamples.length - 1];
  if (newestLeft === undefined) return false;
  const newestRight = rightAt(newestLeft.ts);
  if (newestRight === null) return false;
  const currentSide = Math.sign(newestLeft.value - newestRight);
  if (currentSide === 0) return false;
  let baselineSide = 0;
  for (let i = leftSamples.length - 2; i >= 0; i--) {
    const ls = leftSamples[i];
    if (ls === undefined) continue;
    const rs = rightAt(ls.ts);
    if (rs === null) continue;
    const diff = ls.value - rs;
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
 * Build a `(ts) → number | null` resolver for the right operand.
 *
 * Series-eligible operands walk their series via `asOf`; non-series operands
 * (Literal, state-refs) return a constant pulled from `resolveLatest`.
 */
function rightResolver(
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
 * Unwrap a `Number` {@link StateValue} for the constant-right branch; returns
 * `null` for non-Number / NaN / null so the constant resolver short-circuits.
 */
function asNumber(value: StateValue | null): number | null {
  if (value === null) return null;
  if (value.type !== StateValueType.Number) return null;
  if (Number.isNaN(value.value)) return null;
  return value.value;
}
