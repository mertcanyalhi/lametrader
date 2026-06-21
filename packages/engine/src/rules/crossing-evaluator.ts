import { NumericOperator, type StateValue, StateValueType } from '@lametrader/core';

/**
 * The history-aware {@link NumericOperator}s — detect a crossing between
 * left and right between the previous and current values.
 */
export type CrossingOperator =
  | NumericOperator.Crossing
  | NumericOperator.CrossingUp
  | NumericOperator.CrossingDown;

/**
 * Evaluate a crossing operator using prev + current values of both sides.
 *
 * - `CrossingUp` — left moved from ≤ right to > right.
 * - `CrossingDown` — left moved from ≥ right to < right.
 * - `Crossing` — either of the above.
 *
 * Returns `false` (never throws) if any value is `null` (first-ever
 * observation has no prev), is not a {@link StateValueType.Number}, or is
 * `NaN`.
 */
export function evaluateCrossing(
  operator: CrossingOperator,
  leftPrev: StateValue | null,
  leftCurrent: StateValue | null,
  rightPrev: StateValue | null,
  rightCurrent: StateValue | null,
): boolean {
  const lp = asNumber(leftPrev);
  const lc = asNumber(leftCurrent);
  const rp = asNumber(rightPrev);
  const rc = asNumber(rightCurrent);
  if (lp === null || lc === null || rp === null || rc === null) return false;

  switch (operator) {
    case NumericOperator.CrossingUp:
      return lp <= rp && lc > rc;
    case NumericOperator.CrossingDown:
      return lp >= rp && lc < rc;
    case NumericOperator.Crossing:
      return (lp <= rp && lc > rc) || (lp >= rp && lc < rc);
  }
}

/**
 * Unwrap a `Number` {@link StateValue}; return `null` for missing, non-Number,
 * or `NaN` values so the caller can short-circuit to `false`.
 */
function asNumber(value: StateValue | null): number | null {
  if (value === null) return null;
  if (value.type !== StateValueType.Number) return null;
  if (Number.isNaN(value.value)) return null;
  return value.value;
}
