import { type ConditionNode, ConditionNodeKind } from './condition-tree.types.js';
import { validateOperatorOperands } from './rule-operator.js';

/**
 * Thrown when a {@link ConditionNode} tree is structurally invalid — empty
 * `and`/`or` groups, or a leaf that fails operator/operand type compatibility.
 *
 * Caught at the API/CLI boundary so user-facing errors surface as 400s.
 */
export class RuleConditionError extends Error {
  /**
   * @param message - the human-readable mismatch reason (path into the tree if
   *   useful).
   */
  constructor(message: string) {
    super(message);
    this.name = 'RuleConditionError';
  }
}

/**
 * Recursively validate a rule's condition tree.
 *
 * Rules:
 * - `And` / `Or` groups must have at least one child.
 * - Every `Leaf` must pass {@link validateOperatorOperands} (delegates to the
 *   operator/operand type-compat matrix).
 *
 * @param node - the root of the tree (or a sub-tree, called recursively).
 * @throws {RuleConditionError} when the tree is structurally invalid.
 */
export function validateConditionTree(node: ConditionNode): void {
  if (node.kind === ConditionNodeKind.Leaf) {
    validateOperatorOperands(node.operator, node.left, node.right);
    return;
  }

  if (node.children.length === 0) {
    throw new RuleConditionError(`'${node.kind}' group must have at least one child.`);
  }

  for (const child of node.children) {
    validateConditionTree(child);
  }
}
