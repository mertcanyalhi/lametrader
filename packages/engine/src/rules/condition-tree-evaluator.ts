import { type ConditionNode, ConditionNodeKind } from '@lametrader/core';

/**
 * The `Leaf` variant of a {@link ConditionNode} — extracted for the leaf
 * evaluator callback's signature.
 */
export type ConditionLeaf = Extract<ConditionNode, { kind: ConditionNodeKind.Leaf }>;

/**
 * A pluggable leaf evaluator — the recursion delegates per-leaf judgement to
 * this callback so the operator-specific evaluators (comparison, crossing,
 * state) can be wired together at the orchestrator without coupling the
 * tree walker to any of them.
 */
export type LeafEvaluator = (leaf: ConditionLeaf) => boolean;

/**
 * Walk a {@link ConditionNode} tree and reduce it to a boolean.
 *
 * - `And` returns `true` only when every child is `true`; short-circuits on
 *   the first `false`.
 * - `Or` returns `true` once any child is `true`; short-circuits on the first
 *   `true`.
 * - `Leaf` is delegated to `evaluateLeaf`.
 */
export function evaluateConditionTree(node: ConditionNode, evaluateLeaf: LeafEvaluator): boolean {
  if (node.kind === ConditionNodeKind.Leaf) {
    return evaluateLeaf(node);
  }
  if (node.kind === ConditionNodeKind.And) {
    for (const child of node.children) {
      if (!evaluateConditionTree(child, evaluateLeaf)) return false;
    }
    return true;
  }
  for (const child of node.children) {
    if (evaluateConditionTree(child, evaluateLeaf)) return true;
  }
  return false;
}
