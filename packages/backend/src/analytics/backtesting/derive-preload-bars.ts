import {
  type ConditionNode,
  ConditionNodeKind,
  type IndicatorInstance,
  LeafConditionFamily,
  type Rule,
} from '@lametrader/core';
import type { IndicatorRegistry } from '../indicators/indicator-registry.js';
import { BAR_SERIES_PAGE_SIZE } from '../rules/bar-series-view.js';

/**
 * One page of safety margin added to the derived depth — matches the series
 * pagers' page size so a typical `Crossing` / `Channel` walk-past-flats resolves
 * within the preloaded window before the read-through fallback fires. Purely a
 * performance cushion (correctness is guaranteed by the fallback), so it is
 * tuned by profiling, not by correctness.
 */
const PRELOAD_MARGIN_BARS = BAR_SERIES_PAGE_SIZE;

/**
 * The number of bars, per period, a run should preload **before** `start` so the
 * replay's lookbacks resolve from memory — an intentional over-approximation
 * (spec: *Run semantics → Replay*; ADR-0022).
 *
 * It is the max indicator `warmup(inputs)` over the profile's instances plus the
 * max `Moving` leaf depth (`lookbackBars + 1`) over its rules plus one page of
 * margin, applied uniformly to every active period (lookback is a bar count, so
 * the same figure per period is correct without per-operand period attribution).
 *
 * `Crossing` / `Channel` leaves contribute **nothing** here: their backward walk
 * is data-dependent and statically unbounded, so no bar count bounds them. The
 * preloaded repo's read-through fallback — not this figure — keeps them correct
 * when their walk reaches below the preloaded floor.
 *
 * @param rules - the profile's rules whose `Moving` leaves set the operator depth.
 * @param indicators - the profile's attached indicator instances (warmup source).
 * @param registry - the indicator registry resolving each instance's `warmup`.
 */
export function derivePreloadBars(
  rules: readonly Rule[],
  indicators: readonly IndicatorInstance[],
  registry: IndicatorRegistry,
): number {
  const maxWarmup = indicators.reduce((max, instance) => {
    const module = registry.get(instance.indicatorKey);
    const warmup = module?.warmup
      ? module.warmup(instance.inputs as Parameters<NonNullable<typeof module.warmup>>[0])
      : 0;
    return Math.max(max, warmup);
  }, 0);
  const maxMoving = rules.reduce((max, rule) => Math.max(max, maxMovingDepth(rule.condition)), 0);
  return maxWarmup + maxMoving + PRELOAD_MARGIN_BARS;
}

/**
 * The deepest `Moving` leaf backward-walk (`lookbackBars + 1`) anywhere in a
 * condition tree, or `0` when it holds none — a plain recursive walk over the
 * AND/OR/leaf nodes.
 */
function maxMovingDepth(node: ConditionNode): number {
  if (node.kind === ConditionNodeKind.Leaf) {
    return node.leaf.family === LeafConditionFamily.Moving ? node.leaf.lookbackBars + 1 : 0;
  }
  return node.children.reduce((max, child) => Math.max(max, maxMovingDepth(child)), 0);
}
