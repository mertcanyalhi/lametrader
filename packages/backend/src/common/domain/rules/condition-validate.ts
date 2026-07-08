import {
  type ConditionNode,
  ConditionNodeKind,
  type ConditionOperand,
  type LeafCondition,
  LeafConditionFamily,
  OperandKind,
  type Period,
} from '@lametrader/core';
import { InvalidRuleConditionError } from '../rule.js';

/**
 * Whether an operand resolves against a specific bar period and therefore
 * requires the row's `interval` to disambiguate.
 *
 * `Open` / `High` / `Low` / `Close` / `Volume` / `IndicatorRef` are bar-scoped;
 * `Price` and the state-refs / literals are interval-agnostic (per ADR 0016).
 */
export function operandNeedsInterval(operand: ConditionOperand): boolean {
  switch (operand.kind) {
    case OperandKind.Open:
    case OperandKind.High:
    case OperandKind.Low:
    case OperandKind.Close:
    case OperandKind.Volume:
    case OperandKind.IndicatorRef:
      return true;
    case OperandKind.Price:
    case OperandKind.SymbolStateRef:
    case OperandKind.GlobalStateRef:
    case OperandKind.Literal:
      return false;
  }
}

/**
 * Every operand a leaf carries, across its family-specific layout.
 *
 * Comparison / Crossing / State → `(left, right)`; Channel → `(left, lower,
 * upper)`; Moving → `(left)` (its scalar tuple isn't an operand).
 */
export function leafOperands(leaf: LeafCondition): ConditionOperand[] {
  switch (leaf.family) {
    case LeafConditionFamily.Comparison:
    case LeafConditionFamily.Crossing:
    case LeafConditionFamily.State:
      return [leaf.left, leaf.right];
    case LeafConditionFamily.Channel:
      return [leaf.left, leaf.lower, leaf.upper];
    case LeafConditionFamily.Moving:
      return [leaf.left];
  }
}

/**
 * Whether a leaf needs an `interval` — true iff any of its operands is
 * bar-scoped (OHLCV / `IndicatorRef`).
 */
export function leafNeedsInterval(leaf: LeafCondition): boolean {
  return leafOperands(leaf).some(operandNeedsInterval);
}

/**
 * Collect the distinct `interval`s referenced by bar-scoped leaves in a
 * condition tree, in first-seen order.
 *
 * Used to derive the snapshot period and to validate intervals against a
 * symbol's watched periods.
 */
export function collectConditionIntervals(condition: ConditionNode): Period[] {
  const out: Period[] = [];
  walkLeaves(condition, (leaf) => {
    if (leafNeedsInterval(leaf) && leaf.interval !== undefined && !out.includes(leaf.interval)) {
      out.push(leaf.interval);
    }
  });
  return out;
}

/**
 * Assert that every bar-scoped leaf in `condition` carries an `interval`.
 *
 * @throws {@link InvalidRuleConditionError} for the first leaf that references
 *   an OHLCV / `IndicatorRef` operand without an `interval`.
 */
export function validateRuleCondition(condition: ConditionNode): void {
  walkLeaves(condition, (leaf) => {
    if (leafNeedsInterval(leaf) && leaf.interval === undefined) {
      throw new InvalidRuleConditionError(
        'A condition row referencing an OHLCV or indicator operand requires an interval.',
      );
    }
  });
}

/**
 * Depth-first walk invoking `visit` on every leaf of the condition tree.
 *
 * The one tree traversal the condition helpers share — validation, interval
 * collection, and lookback derivation all enumerate leaves through it.
 */
export function walkLeaves(node: ConditionNode, visit: (leaf: LeafCondition) => void): void {
  if (node.kind === ConditionNodeKind.Leaf) {
    visit(node.leaf);
    return;
  }
  for (const child of node.children) walkLeaves(child, visit);
}
