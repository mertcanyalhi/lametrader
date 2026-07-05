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
 * Returns `false` (never throws) when the series runs dry before reaching the
 * `lookbackBars`-back sample (fewer than `lookbackBars + 1` points), or either
 * reference sample isn't a finite Number.
 *
 * The lazy series has no cheap length, so this walks-and-counts: it steps back
 * up to `lookbackBars + 1` points, reading the newest as `current` and the
 * `lookbackBars`-back one as `past`; if the walk ends before `past` is reached,
 * `past` stays `null` and the leaf returns `false` — exactly the old
 * `length < lookbackBars + 1` guard, without asking the pager for a count.
 */
export async function evaluateMoving(
  leaf: MovingLeafCondition,
  ctx: EvaluationContext,
): Promise<boolean> {
  const series = ctx.resolveSeries(leaf.left, leaf.interval);
  let current: number | null = null;
  let past: number | null = null;
  let stepsSeen = 0;
  for await (const point of series.backwardWalk()) {
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
