import {
  type ConditionNode,
  ConditionNodeKind,
  type ConditionOperand,
  type LeafCondition,
  LeafConditionFamily,
  type StateValue,
} from '@lametrader/core';

import { getLogger } from '../../log.js';
import type { EvaluationContext } from '../evaluation-context.types.js';
import { evaluateLeaf } from '../operators/index.js';

/**
 * Scope-bound logger for the rules operator surface — per-leaf decisions
 * (operator, operand kinds, values, result) land here under the
 * `engine.rules.operators` scope (per #436 / spec rules-trace-scope-logging).
 */
const log = getLogger('engine.rules.operators');

/**
 * Evaluate a condition tree against `context`, reducing to a boolean.
 *
 * `And` short-circuits on the first false child; `Or` short-circuits on the
 * first true child. Leaf nodes delegate to {@link evaluateLeaf} from #390.
 *
 * Each leaf evaluated emits a `leaf_decision` trace under
 * `engine.rules.operators` carrying `{ family, operator, leftKind,
 * leftValue, leftPrev, rightKind?, rightValue?, rightPrev?, result }` —
 * gated by the per-scope level (payload assembly only fires when the level
 * is enabled).
 *
 * Pure — every read goes through `context`. Empty children produce the
 * identity element of the group (`And: true`, `Or: false`), matching the
 * usual short-circuit semantics.
 */
export function evaluateCondition(node: ConditionNode, context: EvaluationContext): boolean {
  switch (node.kind) {
    case ConditionNodeKind.Leaf:
      return evaluateAndTraceLeaf(node.leaf, context);
    case ConditionNodeKind.And:
      for (const child of node.children) {
        if (!evaluateCondition(child, context)) return false;
      }
      return true;
    case ConditionNodeKind.Or:
      for (const child of node.children) {
        if (evaluateCondition(child, context)) return true;
      }
      return false;
  }
}

/**
 * Evaluate one leaf and emit the per-leaf trace.
 *
 * The trace payload mirrors the issue #436 contract:
 * - `family`/`operator` — the leaf's discriminators.
 * - `leftKind` — always present (every leaf has a `left` operand).
 * - `leftValue` / `leftPrev` — `resolveLatest` / `resolvePrev` reads on the
 *   left operand (so a `State` leaf carries the v1 `leaf_decision` shape).
 * - `rightKind` / `rightValue` / `rightPrev` — present when the leaf has a
 *   single right operand (`Comparison`/`Crossing`/`State`); the multi-bound
 *   `Channel` and unary `Moving` shapes omit them.
 * - `result` — the boolean the leaf reduced to.
 *
 * Payload assembly is skipped when the operators-scope is not at `trace`,
 * so the hot path stays free.
 */
function evaluateAndTraceLeaf(leaf: LeafCondition, ctx: EvaluationContext): boolean {
  const result = evaluateLeaf(leaf, ctx);
  if (!log.isLevelEnabled('trace')) return result;
  log.trace(leafTracePayload(leaf, ctx, result), 'leaf_decision');
  return result;
}

/**
 * Snapshot of one leaf decision — built fresh per trace so the persisted
 * Pino record is a plain object (the `EvaluationContext` snapshots aren't
 * serialisable as-is).
 */
interface LeafTracePayload {
  family: LeafConditionFamily;
  operator: string;
  leftKind: string;
  leftValue: StateValue | null;
  leftPrev: StateValue | null;
  rightKind?: string;
  rightValue?: StateValue | null;
  rightPrev?: StateValue | null;
  result: boolean;
}

/** Build the {@link LeafTracePayload} for `leaf` under `ctx` with the known `result`. */
function leafTracePayload(
  leaf: LeafCondition,
  ctx: EvaluationContext,
  result: boolean,
): LeafTracePayload {
  const base: LeafTracePayload = {
    family: leaf.family,
    operator: leaf.operator,
    leftKind: leaf.left.kind,
    leftValue: ctx.resolveLatest(leaf.left, leaf.interval),
    leftPrev: ctx.resolvePrev(leaf.left, leaf.interval),
    result,
  };
  const right = singleRightOperand(leaf);
  if (right === null) return base;
  return {
    ...base,
    rightKind: right.kind,
    rightValue: ctx.resolveLatest(right, leaf.interval),
    rightPrev: ctx.resolvePrev(right, leaf.interval),
  };
}

/**
 * Whether the leaf has a single right operand whose `latest`/`prev` are
 * worth tracing.
 *
 * Returns the right operand for the leaf families that have one; `null` for
 * `Channel` (multi-bound: lower/upper) and `Moving` (unary).
 */
function singleRightOperand(leaf: LeafCondition): ConditionOperand | null {
  switch (leaf.family) {
    case LeafConditionFamily.Comparison:
      return leaf.right;
    case LeafConditionFamily.Crossing:
      return leaf.right;
    case LeafConditionFamily.State:
      return leaf.right;
    case LeafConditionFamily.Channel:
      return null;
    case LeafConditionFamily.Moving:
      return null;
  }
}
