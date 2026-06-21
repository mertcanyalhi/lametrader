import { StateOperator, type StateValue } from '@lametrader/core';

/**
 * Evaluate a {@link StateOperator} against tagged {@link StateValue} operands.
 *
 * - `Equals` / `NotEquals` — value comparison; type mismatch is treated as a
 *   mismatch and yields `false`.
 * - `ChangesTo target` — `leftPrev ≠ target ∧ leftCurrent == target`.
 * - `ChangesFrom source` — `leftPrev == source ∧ leftCurrent ≠ source`.
 *
 * Returns `false` (never throws) when any required operand is `null` (e.g.
 * first-ever observation has no prev) or when the value types disagree —
 * which the validator already rejects upstream, but we stay defensive in
 * case the resolved type drifts at runtime.
 */
export function evaluateState(
  operator: StateOperator,
  leftPrev: StateValue | null,
  leftCurrent: StateValue | null,
  right: StateValue | null,
): boolean {
  if (right === null) return false;

  switch (operator) {
    case StateOperator.Equals:
      return leftCurrent !== null && stateValueEquals(leftCurrent, right);
    case StateOperator.NotEquals:
      if (leftCurrent === null) return false;
      if (leftCurrent.type !== right.type) return false;
      return leftCurrent.value !== right.value;
    case StateOperator.ChangesTo:
      if (leftPrev === null || leftCurrent === null) return false;
      return !stateValueEquals(leftPrev, right) && stateValueEquals(leftCurrent, right);
    case StateOperator.ChangesFrom:
      if (leftPrev === null || leftCurrent === null) return false;
      return stateValueEquals(leftPrev, right) && !stateValueEquals(leftCurrent, right);
  }
}

/**
 * Structural equality on {@link StateValue}s. Mismatched `type` → not equal.
 */
function stateValueEquals(a: StateValue, b: StateValue): boolean {
  return a.type === b.type && a.value === b.value;
}
