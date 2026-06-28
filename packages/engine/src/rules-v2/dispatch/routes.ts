import { RulesV2 } from '@lametrader/core';

/**
 * Decide whether `event` routes to `rule` — i.e., whether the trigger's
 * cadence (and, for cascade events, the condition's slot footprint) matches
 * the event's kind.
 *
 * Routing is the dispatch layer's first stage; it does NOT check scope,
 * profile, or condition truth (those are the orchestrator's, #393).
 * Pure: no I/O, no state.
 *
 * - `Tick` → any tick-cadence trigger (`EveryTime` / `Once` / `OncePerBar`).
 * - `BarOpened` → `OncePerBarOpen` triggers whose `period` matches.
 * - `BarClosed` → `OncePerBarClose` triggers whose `period` matches.
 * - `Timer` → `OncePerInterval` triggers (cadence enforcement lives in the
 *   gate, not in routing).
 * - `SymbolStateChanged` / `GlobalStateChanged` / `IndicatorChanged` → any
 *   rule whose condition tree references the changed slot, regardless of the
 *   rule's trigger kind.
 */
export function routes(event: RulesV2.EvaluationTriggerEvent, rule: RulesV2.Rule): boolean {
  switch (event.kind) {
    case RulesV2.EvaluationTriggerKind.Tick:
      return isTickCadenceTrigger(rule.trigger.kind);
    case RulesV2.EvaluationTriggerKind.BarOpened:
      return (
        rule.trigger.kind === RulesV2.TriggerKind.OncePerBarOpen &&
        rule.trigger.period === event.period
      );
    case RulesV2.EvaluationTriggerKind.BarClosed:
      return (
        rule.trigger.kind === RulesV2.TriggerKind.OncePerBarClose &&
        rule.trigger.period === event.period
      );
    case RulesV2.EvaluationTriggerKind.Timer:
      return rule.trigger.kind === RulesV2.TriggerKind.OncePerInterval;
    case RulesV2.EvaluationTriggerKind.SymbolStateChanged:
      return anyOperand(
        rule.condition,
        (op) => op.kind === RulesV2.OperandKind.SymbolStateRef && op.key === event.key,
      );
    case RulesV2.EvaluationTriggerKind.GlobalStateChanged:
      return anyOperand(
        rule.condition,
        (op) => op.kind === RulesV2.OperandKind.GlobalStateRef && op.key === event.key,
      );
    case RulesV2.EvaluationTriggerKind.IndicatorChanged:
      return anyOperand(
        rule.condition,
        (op) =>
          op.kind === RulesV2.OperandKind.IndicatorRef &&
          op.instanceId === event.instanceId &&
          op.stateKey === event.stateKey,
      );
  }
}

/** Whether a trigger kind re-evaluates on every tick event. */
function isTickCadenceTrigger(kind: RulesV2.TriggerKind): boolean {
  return (
    kind === RulesV2.TriggerKind.EveryTime ||
    kind === RulesV2.TriggerKind.Once ||
    kind === RulesV2.TriggerKind.OncePerBar
  );
}

/**
 * Walk `condition` and return `true` if any operand on any leaf satisfies
 * `predicate`. Visits AND / OR children recursively.
 */
function anyOperand(
  condition: RulesV2.ConditionNode,
  predicate: (operand: RulesV2.ConditionOperand) => boolean,
): boolean {
  switch (condition.kind) {
    case RulesV2.ConditionNodeKind.And:
    case RulesV2.ConditionNodeKind.Or:
      return condition.children.some((child) => anyOperand(child, predicate));
    case RulesV2.ConditionNodeKind.Leaf:
      return leafOperands(condition.leaf).some(predicate);
  }
}

/**
 * Extract every operand a {@link RulesV2.LeafCondition} reads — the union of
 * the operand fields each family carries.
 */
function leafOperands(leaf: RulesV2.LeafCondition): RulesV2.ConditionOperand[] {
  switch (leaf.family) {
    case RulesV2.LeafConditionFamily.Comparison:
    case RulesV2.LeafConditionFamily.Crossing:
    case RulesV2.LeafConditionFamily.State:
      return [leaf.left, leaf.right];
    case RulesV2.LeafConditionFamily.Channel:
      return [leaf.left, leaf.lower, leaf.upper];
    case RulesV2.LeafConditionFamily.Moving:
      return [leaf.left];
  }
}
