import { RulesV2 } from '@lametrader/core';

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
 * Returns `false` (never throws) when the series resolves to `null`, has
 * fewer than `lookbackBars + 1` samples, or either reference sample is `NaN`.
 */
export function evaluateMoving(leaf: RulesV2.MovingLeafCondition, ctx: EvaluationContext): boolean {
  const series = ctx.resolveSeries(leaf.left);
  if (series === null) return false;
  const samples = series.samples();
  if (samples.length < leaf.lookbackBars + 1) return false;
  const current = samples[samples.length - 1];
  const past = samples[samples.length - 1 - leaf.lookbackBars];
  if (current === undefined || past === undefined) return false;
  if (Number.isNaN(current.value) || Number.isNaN(past.value)) return false;
  const delta = current.value - past.value;
  switch (leaf.operator) {
    case RulesV2.MovingOperator.MovingUp:
      return delta >= leaf.threshold;
    case RulesV2.MovingOperator.MovingDown:
      return -delta >= leaf.threshold;
    case RulesV2.MovingOperator.MovingUpPercent:
      if (past.value === 0) return false;
      return (delta / past.value) * 100 >= leaf.threshold;
    case RulesV2.MovingOperator.MovingDownPercent:
      if (past.value === 0) return false;
      return (-delta / past.value) * 100 >= leaf.threshold;
  }
}
