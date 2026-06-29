import {
  type MovingLeafCondition,
  MovingOperator,
  type StateValue,
  StateValueType,
} from '@lametrader/core';

import type { EvaluationContext } from '../evaluation-context.types.js';

/**
 * Evaluate a unary + scalar-tuple series-aware movement leaf.
 *
 * Compares the operand's latest sample to the sample `lookbackBars` indices
 * back on its own series.
 * Absolute variants test `|delta| >= threshold`; percent variants test the
 * percent change against the threshold (with a divide-by-zero guard on
 * `past.value === 0`).
 *
 * Returns `false` (never throws) when the series has fewer than
 * `lookbackBars + 1` samples, or either reference sample isn't a finite Number.
 */
export function evaluateMoving(leaf: MovingLeafCondition, ctx: EvaluationContext): boolean {
  const series = ctx.resolveSeries(leaf.left);
  if (series.length < leaf.lookbackBars + 1) return false;
  let current: number | null = null;
  let past: number | null = null;
  let stepsSeen = 0;
  for (const point of series.backwardWalk()) {
    if (stepsSeen === 0) {
      current = numericPoint(point.value);
      if (current === null) return false;
    }
    if (stepsSeen === leaf.lookbackBars) {
      past = numericPoint(point.value);
      if (past === null) return false;
      break;
    }
    stepsSeen += 1;
  }
  if (current === null || past === null) return false;
  const delta = current - past;
  switch (leaf.operator) {
    case MovingOperator.MovingUp:
      return delta >= leaf.threshold;
    case MovingOperator.MovingDown:
      return -delta >= leaf.threshold;
    case MovingOperator.MovingUpPercent:
      if (past === 0) return false;
      return (delta / past) * 100 >= leaf.threshold;
    case MovingOperator.MovingDownPercent:
      if (past === 0) return false;
      return (-delta / past) * 100 >= leaf.threshold;
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
