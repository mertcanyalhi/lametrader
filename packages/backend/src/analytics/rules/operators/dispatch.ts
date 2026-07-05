import { type LeafCondition, LeafConditionFamily } from '@lametrader/core';

import type { EvaluationContext } from '../evaluation-context.types.js';
import { evaluateChannel } from './channel.js';
import { evaluateComparison } from './comparison.js';
import { evaluateCrossing } from './crossing.js';
import { evaluateMoving } from './moving.js';
import { evaluateState } from './state.js';

/**
 * Dispatch a {@link LeafCondition} to the operator family function it
 * belongs to and return the resulting boolean.
 *
 * The discriminator is `leaf.family` — exhaustive over every family in
 * {@link LeafConditionFamily}.
 *
 * Async: every read goes through {@link EvaluationContext}, whose series views
 * may page the candle repository lazily as an operator walks. No clock reads.
 * Resolves to `false` on any "no data yet" branch (never throws).
 */
export function evaluateLeaf(leaf: LeafCondition, ctx: EvaluationContext): Promise<boolean> {
  switch (leaf.family) {
    case LeafConditionFamily.Comparison:
      return evaluateComparison(leaf, ctx);
    case LeafConditionFamily.Crossing:
      return evaluateCrossing(leaf, ctx);
    case LeafConditionFamily.Channel:
      return evaluateChannel(leaf, ctx);
    case LeafConditionFamily.Moving:
      return evaluateMoving(leaf, ctx);
    case LeafConditionFamily.State:
      return evaluateState(leaf, ctx);
  }
}
