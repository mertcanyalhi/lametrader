import { RulesV2 } from '@lametrader/core';

import type { EvaluationContext } from '../evaluation-context.types.js';
import { evaluateLeaf } from '../operators/index.js';

/**
 * Evaluate a v2 condition tree against `context`, reducing to a boolean.
 *
 * `And` short-circuits on the first false child; `Or` short-circuits on the
 * first true child. Leaf nodes delegate to {@link evaluateLeaf} from #390.
 *
 * Pure — every read goes through `context`. Empty children produce the
 * identity element of the group (`And: true`, `Or: false`), matching the
 * usual short-circuit semantics.
 */
export function evaluateCondition(
  node: RulesV2.ConditionNode,
  context: EvaluationContext,
): boolean {
  switch (node.kind) {
    case RulesV2.ConditionNodeKind.Leaf:
      return evaluateLeaf(node.leaf, context);
    case RulesV2.ConditionNodeKind.And:
      for (const child of node.children) {
        if (!evaluateCondition(child, context)) return false;
      }
      return true;
    case RulesV2.ConditionNodeKind.Or:
      for (const child of node.children) {
        if (evaluateCondition(child, context)) return true;
      }
      return false;
  }
}
