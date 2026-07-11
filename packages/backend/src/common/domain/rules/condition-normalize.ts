import {
  ComparisonOperator,
  type ConditionNode,
  ConditionNodeKind,
  type ConditionOperand,
  type LeafCondition,
  LeafConditionFamily,
  OperandKind,
  type Rule,
  StateOperator,
  StateValueType,
} from '@lametrader/core';

/**
 * Read-time migration for the collapsed `Equals` / `NotEquals` operator
 * vocabulary (issue #429).
 *
 * Pre-collapse the operator picker exposed both the Comparison and the State
 * dialect of equality side-by-side; post-collapse the picker only ever emits
 * one — and the engine continues to dispatch by the leaf's `family`.
 *
 * Old documents persisted as `family: State, operator: Equals` with a
 * non-state-ref LHS would now mismatch the picker's family choice for that LHS.
 * This rewrites those legacy leaves to `family: Comparison, operator: Eq`
 * (`NotEquals` → `Neq`) at read time so the engine sees the picker-correct
 * shape without an offline migration.
 *
 * State-ref LHS (`SymbolStateRef` / `GlobalStateRef`) keeps its State family —
 * those dispatch through NULL-aware semantics (a `null` resolution is a
 * distinct sentinel, not "no data → false"), which is the post-collapse
 * contract for state-ref equality.
 *
 * A non-numeric `IndicatorRef` LHS (`valueType` `Bool` / `String`) likewise
 * keeps its State family: `comparison/Eq` is numeric-only and would silently
 * evaluate a bool/enum field to `false`, so a Bool/enum indicator field only
 * ever compares through the type-agnostic State operators (#562, ADR-0022).
 * A numeric `IndicatorRef` (`valueType` `Number`, or a legacy operand with no
 * `valueType`) still rewrites, preserving the pre-#562 behaviour.
 *
 * Identity-preserving: when no leaf needs rewriting the input `rule` is
 * returned unchanged, so the orchestrator's hot path doesn't allocate.
 */
export function normalizeRule(rule: Rule): Rule {
  const normalized = normalizeNode(rule.condition);
  if (normalized === rule.condition) return rule;
  return { ...rule, condition: normalized };
}

/**
 * Walk a {@link ConditionNode} and return a copy with every legacy `state/Equals`
 * (or `state/NotEquals`) leaf over a non-state-ref LHS rewritten to its
 * `comparison/Eq` (`Neq`) equivalent.
 *
 * Returns the input reference when nothing needed to change, so callers can
 * cheaply detect a no-op rewrite.
 */
function normalizeNode(node: ConditionNode): ConditionNode {
  if (node.kind === ConditionNodeKind.Leaf) {
    const next = normalizeLeaf(node.leaf);
    if (next === node.leaf) return node;
    return { kind: ConditionNodeKind.Leaf, leaf: next };
  }
  let changed = false;
  const children = node.children.map((child) => {
    const next = normalizeNode(child);
    if (next !== child) changed = true;
    return next;
  });
  if (!changed) return node;
  return { kind: node.kind, children };
}

/**
 * Rewrite a single {@link LeafCondition} if it's a legacy `state/Equals` /
 * `state/NotEquals` over a non-state-ref LHS; otherwise return the input
 * reference unchanged.
 */
function normalizeLeaf(leaf: LeafCondition): LeafCondition {
  if (leaf.family !== LeafConditionFamily.State) return leaf;
  if (leaf.operator !== StateOperator.Equals && leaf.operator !== StateOperator.NotEquals) {
    return leaf;
  }
  if (keepsStateFamily(leaf.left)) return leaf;
  const operator =
    leaf.operator === StateOperator.Equals ? ComparisonOperator.Eq : ComparisonOperator.Neq;
  const rewritten: LeafCondition = {
    family: LeafConditionFamily.Comparison,
    operator,
    left: leaf.left,
    right: leaf.right,
    ...(leaf.interval === undefined ? {} : { interval: leaf.interval }),
  };
  return rewritten;
}

/**
 * Whether an equality leaf over this LHS keeps its State family post-collapse
 * (rather than being rewritten to `comparison/Eq`).
 *
 * True for the profile-scoped state maps (`SymbolStateRef` / `GlobalStateRef`)
 * and for a non-numeric `IndicatorRef` (`valueType` `Bool` / `String`): all of
 * these carry a non-numeric or NULL-aware value that `comparison/Eq` — a
 * numeric operator — cannot evaluate.
 * A numeric `IndicatorRef` (`valueType` `Number`, or a legacy operand without a
 * `valueType`) is left to rewrite, preserving the pre-#562 behaviour.
 */
function keepsStateFamily(operand: ConditionOperand): boolean {
  if (operand.kind === OperandKind.SymbolStateRef || operand.kind === OperandKind.GlobalStateRef) {
    return true;
  }
  return (
    operand.kind === OperandKind.IndicatorRef &&
    (operand.valueType === StateValueType.Bool || operand.valueType === StateValueType.String)
  );
}
