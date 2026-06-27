import {
  type ConditionNode,
  ConditionNodeKind,
  NumericOperator,
  StateOperator,
  type StateOperator as StateOperatorType,
  type StateValue,
  StateValueType,
} from '@lametrader/core';

import { getLogger } from '../log.js';
import type { EvaluationContext } from './evaluation-context.types.js';

/** Scope-bound logger for the condition evaluator. */
const log = getLogger('condition-evaluator');

/**
 * Evaluate a rule's full condition tree against `context`, reducing to a
 * boolean.
 *
 * Owns:
 *   - tree walk (`And` short-circuits on first false; `Or` on first true)
 *   - leaf dispatch (resolves operands, classifies operator)
 *   - per-operator semantics:
 *       comparison (`gt|lt|gte|lte|eq|neq`)
 *       crossing   (`crossing|crossing-up|crossing-down`)
 *       state      (`equals|not-equals|changes-to|changes-from`)
 *
 * Pure: all reads come from `context`, no I/O. Defensive on every operand —
 * `null` / wrong-type / `NaN` short-circuit the leaf to `false` rather than
 * throw, so a poisoned resolve never crashes the engine.
 *
 * Emits one `leaf_decision` trace per leaf (#354) when `ruleId` is provided;
 * the trace records the resolved value, its {@link OperandValueSource}, and
 * the leaf's result.
 */
export function evaluateCondition(
  tree: ConditionNode,
  context: EvaluationContext,
  ruleId?: string,
): boolean {
  return walk(tree, context, { leafIndex: 0 }, ruleId);
}

/** Per-tick mutable cursor that tracks which leaf the walk is currently visiting. */
interface WalkState {
  leafIndex: number;
}

/**
 * Recursively reduce a condition tree. `And` short-circuits on the first
 * `false` child; `Or` short-circuits on the first `true`. Leaf nodes delegate
 * to {@link evaluateLeaf}.
 */
function walk(
  node: ConditionNode,
  context: EvaluationContext,
  state: WalkState,
  ruleId: string | undefined,
): boolean {
  if (node.kind === ConditionNodeKind.Leaf) {
    return evaluateLeaf(node, context, state.leafIndex++, ruleId);
  }
  if (node.kind === ConditionNodeKind.And) {
    for (const child of node.children) {
      if (!walk(child, context, state, ruleId)) return false;
    }
    return true;
  }
  for (const child of node.children) {
    if (walk(child, context, state, ruleId)) return true;
  }
  return false;
}

/** The `Leaf` variant of a {@link ConditionNode} — used internally by the dispatcher. */
type ConditionLeafNode = Extract<ConditionNode, { kind: ConditionNodeKind.Leaf }>;

/**
 * Evaluate one leaf against the context, dispatching on the leaf operator's
 * category (comparison / crossing / state).
 *
 * State and crossing operators consume operand-specific `(prev, current)` pairs
 * from {@link EvaluationContext.resolvePrevCurrent}, so the operator's history
 * reads off the **operand's** history rather than the inbound event's value
 * axis (#357). Comparison operators read `.current` only.
 */
function evaluateLeaf(
  leaf: ConditionLeafNode,
  context: EvaluationContext,
  leafIndex: number,
  ruleId: string | undefined,
): boolean {
  const op = leaf.operator;
  const leftResolved = context.resolveTraced(leaf.left);
  const rightResolved = context.resolveTraced(leaf.right);
  const left = leftResolved.value;
  const right = rightResolved.value;
  let result: boolean;
  if (isComparisonOp(op)) {
    result = evaluateComparison(op, left, right);
  } else if (isCrossingOp(op)) {
    const leftPc = context.resolvePrevCurrent(leaf.left);
    const rightPc = context.resolvePrevCurrent(leaf.right);
    result = evaluateCrossing(op, leftPc.prev, leftPc.current, rightPc.prev, rightPc.current);
  } else {
    const leftPc = context.resolvePrevCurrent(leaf.left);
    result = evaluateState(op, leftPc.prev, leftPc.current, right);
  }
  if (ruleId !== undefined) {
    log.trace(
      {
        ruleId,
        leafIndex,
        operator: op,
        leftDescriptor: leaf.left,
        leftValue: left,
        leftSource: leftResolved.source,
        rightDescriptor: leaf.right,
        rightValue: right,
        rightSource: rightResolved.source,
        result,
      },
      'leaf_decision',
    );
  }
  return result;
}

/** Numeric comparison operators — stateless tests on `current` values. */
type ComparisonOperator =
  | NumericOperator.Gt
  | NumericOperator.Lt
  | NumericOperator.Gte
  | NumericOperator.Lte
  | NumericOperator.Eq
  | NumericOperator.Neq;

/** History-aware numeric operators — detect a crossing between left and right. */
type CrossingOperator =
  | NumericOperator.Crossing
  | NumericOperator.CrossingUp
  | NumericOperator.CrossingDown;

const COMPARISON_OPS = new Set<string>([
  NumericOperator.Gt,
  NumericOperator.Lt,
  NumericOperator.Gte,
  NumericOperator.Lte,
  NumericOperator.Eq,
  NumericOperator.Neq,
]);

const CROSSING_OPS = new Set<string>([
  NumericOperator.Crossing,
  NumericOperator.CrossingUp,
  NumericOperator.CrossingDown,
]);

function isComparisonOp(op: string): op is ComparisonOperator {
  return COMPARISON_OPS.has(op);
}

function isCrossingOp(op: string): op is CrossingOperator {
  return CROSSING_OPS.has(op);
}

/**
 * Stateless numeric comparison between two resolved operand values.
 *
 * Returns `false` (never throws) when either operand is `null`, is not a
 * {@link StateValueType.Number}, or carries `NaN`.
 */
function evaluateComparison(
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

/**
 * History-aware crossing operator.
 *
 * - `CrossingUp` — left moved from ≤ right to > right.
 * - `CrossingDown` — left moved from ≥ right to < right.
 * - `Crossing` — either of the above.
 *
 * Returns `false` (never throws) if any value is `null`, is not a
 * {@link StateValueType.Number}, or is `NaN`.
 */
function evaluateCrossing(
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
 * Evaluate a {@link StateOperator} against tagged {@link StateValue} operands.
 *
 * `null` is treated as a distinct sentinel value (the "unset" value) — equal
 * to itself, distinct from every concrete value, and a real transition
 * endpoint for {@link StateOperator.ChangesTo} / {@link StateOperator.ChangesFrom}.
 *
 * `NotEquals` keeps the defensive type-mismatch carve-out: two concrete operands
 * of different `StateValueType` produce `false` for both `Equals` and `NotEquals`.
 */
function evaluateState(
  operator: StateOperatorType,
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
