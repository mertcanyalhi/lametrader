import { NumericOperator, type StateValue, StateValueType } from '@lametrader/core';

/**
 * The subset of {@link NumericOperator}s this evaluator handles — stateless
 * numeric comparisons (`gt`, `lt`, `gte`, `lte`, `eq`, `neq`).
 *
 * The history-aware crossing operators (`crossing`, `crossing-up`,
 * `crossing-down`) live in their own evaluator (see #119) because they
 * additionally need the previous values of the operands.
 */
export type ComparisonOperator =
  | NumericOperator.Gt
  | NumericOperator.Lt
  | NumericOperator.Gte
  | NumericOperator.Lte
  | NumericOperator.Eq
  | NumericOperator.Neq;

/**
 * Evaluate a stateless numeric comparison between two resolved operand
 * values.
 *
 * Returns `false` (never throws) when either operand is `null`, is not a
 * {@link StateValueType.Number}, or carries `NaN` — so an unresolved operand
 * or a poisoned value harmlessly drops the leaf.
 */
export function evaluateComparison(
  operator: ComparisonOperator,
  left: StateValue | null,
  right: StateValue | null,
): boolean {
  if (left === null || right === null) return false;
  if (left.type !== StateValueType.Number || right.type !== StateValueType.Number) return false;
  if (Number.isNaN(left.value) || Number.isNaN(right.value)) return false;
  switch (operator) {
    case NumericOperator.Gt:
      return left.value > right.value;
    case NumericOperator.Lt:
      return left.value < right.value;
    case NumericOperator.Gte:
      return left.value >= right.value;
    case NumericOperator.Lte:
      return left.value <= right.value;
    case NumericOperator.Eq:
      return left.value === right.value;
    case NumericOperator.Neq:
      return left.value !== right.value;
  }
}
