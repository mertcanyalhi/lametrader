import { StateOperator, type StateValue } from '@lametrader/core';

/**
 * Evaluate a {@link StateOperator} against tagged {@link StateValue} operands.
 *
 * `null` is treated as a distinct sentinel value (the "unset" value) — it's
 * equal to itself, distinct from every concrete value, and counts as a real
 * transition endpoint for {@link StateOperator.ChangesTo} /
 * {@link StateOperator.ChangesFrom}. This gives `Equals XOR NotEquals = true`
 * for every input pair so the bootstrap pattern (`signal != "SELL"` on the
 * first bar) fires as expected.
 *
 * `NotEquals` keeps the defensive type-mismatch carve-out from the validator
 * boundary: two concrete operands of different `StateValueType` produce `false`
 * for both `Equals` and `NotEquals` (the validator already rejects this
 * upstream, but we stay defensive in case the resolved type drifts at runtime).
 */
export function evaluateState(
  operator: StateOperator,
  leftPrev: StateValue | null,
  leftCurrent: StateValue | null,
  right: StateValue | null,
): boolean {
  switch (operator) {
    case StateOperator.Equals:
      return nullableEquals(leftCurrent, right);
    case StateOperator.NotEquals:
      if (leftCurrent !== null && right !== null && leftCurrent.type !== right.type) return false;
      return !nullableEquals(leftCurrent, right);
    case StateOperator.ChangesTo:
      return !nullableEquals(leftPrev, right) && nullableEquals(leftCurrent, right);
    case StateOperator.ChangesFrom:
      return nullableEquals(leftPrev, right) && !nullableEquals(leftCurrent, right);
  }
}

/**
 * Structural equality on nullable {@link StateValue}s under the sentinel model:
 * two `null`s are equal, `null` is unequal to any concrete value, and two
 * concrete values are equal iff they share `type` and `value`.
 */
function nullableEquals(a: StateValue | null, b: StateValue | null): boolean {
  if (a === null) return b === null;
  if (b === null) return false;
  return a.type === b.type && a.value === b.value;
}
