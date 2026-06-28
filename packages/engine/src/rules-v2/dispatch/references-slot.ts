import { RulesV2 } from '@lametrader/core';

/**
 * One of the three cascade-event kinds that carry a "slot" identifier the
 * dispatcher needs to map back to rule-condition operands.
 */
type CascadeEvent =
  | RulesV2.SymbolStateChangedEvent
  | RulesV2.GlobalStateChangedEvent
  | RulesV2.IndicatorChangedEvent;

/**
 * Decide whether a rule's condition tree references the slot mutated by
 * `event` — pure, recursive walk over the tree's leaves.
 *
 * Each cascade event carries an identifier (`(profileId, key)` for global,
 * `(profileId, symbolId, key)` for symbol-scoped, `(instanceId, stateKey)` for
 * indicator) that the dispatcher matches against operand references. Only
 * rules whose condition reads the changed slot are woken; everyone else
 * stays asleep (no spurious dispatch).
 */
export function referencesSlot(condition: RulesV2.ConditionNode, event: CascadeEvent): boolean {
  if (condition.kind === RulesV2.ConditionNodeKind.Leaf) {
    return leafReadsSlot(condition.leaf, event);
  }
  for (const child of condition.children) {
    if (referencesSlot(child, event)) return true;
  }
  return false;
}

/**
 * Whether any operand on `leaf` reads the slot mutated by `event`.
 *
 * The leaf-family discriminates the operand layout: comparison/crossing/state
 * carry `(left, right)`; channel carries `(left, lower, upper)`; moving
 * carries only `left`. We collect each leaf's operands and probe each.
 */
function leafReadsSlot(leaf: RulesV2.LeafCondition, event: CascadeEvent): boolean {
  for (const operand of leafOperands(leaf)) {
    if (operandReadsSlot(operand, event)) return true;
  }
  return false;
}

/**
 * Enumerate the operands a leaf reads, by family.
 *
 * Returned as an array (not iterator) so the caller can early-return cleanly.
 */
function leafOperands(leaf: RulesV2.LeafCondition): RulesV2.ConditionOperand[] {
  switch (leaf.family) {
    case RulesV2.LeafConditionFamily.Channel:
      return [leaf.left, leaf.lower, leaf.upper];
    case RulesV2.LeafConditionFamily.Moving:
      return [leaf.left];
    case RulesV2.LeafConditionFamily.Comparison:
    case RulesV2.LeafConditionFamily.Crossing:
    case RulesV2.LeafConditionFamily.State:
      return [leaf.left, leaf.right];
  }
}

/**
 * Whether a single operand matches the cascade event's slot — exact-match on
 * key + scope identifier (no fuzzy lookups).
 */
function operandReadsSlot(operand: RulesV2.ConditionOperand, event: CascadeEvent): boolean {
  switch (event.kind) {
    case RulesV2.EvaluationTriggerKind.SymbolStateChanged:
      return operand.kind === RulesV2.OperandKind.SymbolStateRef && operand.key === event.key;
    case RulesV2.EvaluationTriggerKind.GlobalStateChanged:
      return operand.kind === RulesV2.OperandKind.GlobalStateRef && operand.key === event.key;
    case RulesV2.EvaluationTriggerKind.IndicatorChanged:
      return (
        operand.kind === RulesV2.OperandKind.IndicatorRef &&
        operand.instanceId === event.instanceId &&
        operand.stateKey === event.stateKey
      );
  }
}
