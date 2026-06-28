import { RulesV2 } from '@lametrader/core';

import type { EvaluationContext } from '../evaluation-context.types.js';
import { evaluateChannel } from './channel.js';
import { evaluateComparison } from './comparison.js';
import { evaluateCrossing } from './crossing.js';
import { evaluateMoving } from './moving.js';
import { evaluateState } from './state.js';

/**
 * Dispatch a {@link RulesV2.LeafCondition} to the operator family function it
 * belongs to and return the resulting boolean.
 *
 * The discriminator is `leaf.family` — exhaustive over every family in
 * {@link RulesV2.LeafConditionFamily}.
 *
 * Pure: every read inside the dispatched function goes through
 * {@link EvaluationContext}; no I/O, no clock reads. Returns `false` on any
 * "no data yet" branch (never throws).
 */
export function evaluateLeaf(leaf: RulesV2.LeafCondition, ctx: EvaluationContext): boolean {
  switch (leaf.family) {
    case RulesV2.LeafConditionFamily.Comparison:
      return evaluateComparison(leaf, ctx);
    case RulesV2.LeafConditionFamily.Crossing:
      return evaluateCrossing(leaf, ctx);
    case RulesV2.LeafConditionFamily.Channel:
      return evaluateChannel(leaf, ctx);
    case RulesV2.LeafConditionFamily.Moving:
      return evaluateMoving(leaf, ctx);
    case RulesV2.LeafConditionFamily.State:
      return evaluateState(leaf, ctx);
  }
}
