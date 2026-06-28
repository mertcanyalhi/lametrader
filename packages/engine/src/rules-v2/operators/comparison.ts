import { RulesV2, type StateValue, StateValueType } from '@lametrader/core';

import type { EvaluationContext } from '../evaluation-context.types.js';

/**
 * Evaluate a binary snapshot comparison leaf — reads both operands via
 * {@link EvaluationContext.resolveLatest} and applies the numeric operator.
 *
 * Returns `false` (never throws) when either operand resolves to `null`,
 * either side is not a {@link StateValueType.Number}, or either value is
 * `NaN` — matches CONTEXT.md's "no data yet → false" semantics.
 */
export function evaluateComparison(
  leaf: RulesV2.ComparisonLeafCondition,
  ctx: EvaluationContext,
): boolean {
  const left = asNumber(ctx.resolveLatest(leaf.left));
  const right = asNumber(ctx.resolveLatest(leaf.right));
  if (left === null || right === null) return false;
  switch (leaf.operator) {
    case RulesV2.ComparisonOperator.Gt:
      return left > right;
    case RulesV2.ComparisonOperator.Lt:
      return left < right;
    case RulesV2.ComparisonOperator.Gte:
      return left >= right;
    case RulesV2.ComparisonOperator.Lte:
      return left <= right;
    case RulesV2.ComparisonOperator.Eq:
      return left === right;
    case RulesV2.ComparisonOperator.Neq:
      return left !== right;
  }
}

/**
 * Unwrap a `Number` {@link StateValue}; return `null` for `null`, non-Number,
 * or `NaN` so the caller short-circuits to `false`.
 */
function asNumber(value: StateValue | null): number | null {
  if (value === null) return null;
  if (value.type !== StateValueType.Number) return null;
  if (Number.isNaN(value.value)) return null;
  return value.value;
}
