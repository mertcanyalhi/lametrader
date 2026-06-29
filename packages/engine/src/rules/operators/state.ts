import { type StateLeafCondition, StateOperator, type StateValue } from '@lametrader/core';

import type { EvaluationContext } from '../evaluation-context.types.js';

/**
 * Evaluate a snapshot / transition state leaf — `Equals` / `NotEquals` /
 * `ChangesTo` / `ChangesFrom`.
 *
 * Ported verbatim from v1's semantics (per CONTEXT.md "State operators carry
 * forward from today as-is"):
 * - `null` is a distinct sentinel — equal to itself, unequal to any
 *   concrete value, a valid endpoint for `ChangesTo` / `ChangesFrom`.
 * - `NotEquals` keeps the defensive carve-out: two concrete operands of
 *   different `StateValueType` produce `false` for both `Equals` and
 *   `NotEquals`.
 *
 * The left operand is read via `resolveLatest` (current) and `resolvePrev`
 * (prior snapshot); the right via `resolveLatest`.
 */
export function evaluateState(leaf: StateLeafCondition, ctx: EvaluationContext): boolean {
  const leftCurrent = ctx.resolveLatest(leaf.left);
  const leftPrev = ctx.resolvePrev(leaf.left);
  const right = ctx.resolveLatest(leaf.right);
  switch (leaf.operator) {
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
 * Structural equality on nullable {@link StateValue}s under the sentinel
 * model: two `null`s are equal, `null` is unequal to any concrete value, and
 * two concrete values are equal iff they share `type` and `value`.
 */
function nullableEquals(a: StateValue | null, b: StateValue | null): boolean {
  if (a === null) return b === null;
  if (b === null) return false;
  return a.type === b.type && a.value === b.value;
}
