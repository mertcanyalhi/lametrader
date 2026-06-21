import type { ConditionOperand } from './condition-operand.types.js';
import type { RuleOperator } from './rule-operator.types.js';

/**
 * The kind of a {@link ConditionNode} — what role it plays in the condition
 * tree.
 *
 * The string value is the persisted/serialized tag (stable across JSON
 * round-trips).
 */
export enum ConditionNodeKind {
  /** A group whose children are all true. */
  And = 'and',
  /** A group with at least one true child. */
  Or = 'or',
  /** A `left operator right` comparison. */
  Leaf = 'leaf',
}

/**
 * One node of a rule's condition tree: a leaf comparison or a nested AND/OR
 * group of further nodes.
 *
 * The shape is recursive — `And` / `Or` groups carry an array of further
 * {@link ConditionNode}s, mixing leaves and nested groups freely.
 */
export type ConditionNode =
  | { kind: ConditionNodeKind.And; children: ConditionNode[] }
  | { kind: ConditionNodeKind.Or; children: ConditionNode[] }
  | {
      kind: ConditionNodeKind.Leaf;
      left: ConditionOperand;
      operator: RuleOperator;
      right: ConditionOperand;
    };
