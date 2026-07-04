import {
  type ConditionNode,
  ConditionNodeKind,
  type ConditionOperand,
  EvaluationTriggerKind,
  type GlobalStateChangedEvent,
  type IndicatorChangedEvent,
  type LeafCondition,
  LeafConditionFamily,
  OperandKind,
  type SymbolStateChangedEvent,
} from '@lametrader/core';

/**
 * One of the three cascade-event kinds that carry a "slot" identifier the
 * dispatcher needs to map back to rule-condition operands.
 */
type CascadeEvent = SymbolStateChangedEvent | GlobalStateChangedEvent | IndicatorChangedEvent;

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
export function referencesSlot(condition: ConditionNode, event: CascadeEvent): boolean {
  if (condition.kind === ConditionNodeKind.Leaf) {
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
function leafReadsSlot(leaf: LeafCondition, event: CascadeEvent): boolean {
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
function leafOperands(leaf: LeafCondition): ConditionOperand[] {
  switch (leaf.family) {
    case LeafConditionFamily.Channel:
      return [leaf.left, leaf.lower, leaf.upper];
    case LeafConditionFamily.Moving:
      return [leaf.left];
    case LeafConditionFamily.Comparison:
    case LeafConditionFamily.Crossing:
    case LeafConditionFamily.State:
      return [leaf.left, leaf.right];
  }
}

/**
 * Whether a single operand matches the cascade event's slot — exact-match on
 * key + scope identifier (no fuzzy lookups).
 */
function operandReadsSlot(operand: ConditionOperand, event: CascadeEvent): boolean {
  switch (event.kind) {
    case EvaluationTriggerKind.SymbolStateChanged:
      return operand.kind === OperandKind.SymbolStateRef && operand.key === event.key;
    case EvaluationTriggerKind.GlobalStateChanged:
      return operand.kind === OperandKind.GlobalStateRef && operand.key === event.key;
    case EvaluationTriggerKind.IndicatorChanged:
      return (
        operand.kind === OperandKind.IndicatorRef &&
        operand.instanceId === event.instanceId &&
        operand.stateKey === event.stateKey
      );
  }
}
