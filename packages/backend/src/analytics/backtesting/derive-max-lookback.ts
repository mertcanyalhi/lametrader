import {
  type ConditionNode,
  type LeafCondition,
  LeafConditionFamily,
  type Period,
  type Profile,
  type Rule,
} from '@lametrader/core';
import { walkLeaves } from '../../common/domain/rules/condition-validate.js';
import type { IndicatorRegistry } from '../indicators/indicator-registry.js';
import { BAR_SERIES_PAGE_SIZE } from '../rules/bar-series-view.js';
import type { MaxLookbackByPeriod } from './derive-max-lookback.types.js';

/**
 * Round a raw bar count up to a whole {@link BAR_SERIES_PAGE_SIZE} multiple,
 * plus one page of safety margin.
 *
 * Rounding to the pagers' page size keeps the window aligned with their fetch
 * granularity; the extra page absorbs a pager stepping one page past the last
 * point it needs before it observes a short page and stops (design §2 of
 * `docs/designs/streaming-backtest-feed.md`).
 */
export function roundToPage(bars: number): number {
  return Math.ceil(bars / BAR_SERIES_PAGE_SIZE) * BAR_SERIES_PAGE_SIZE + BAR_SERIES_PAGE_SIZE;
}

/**
 * Backward-walk depth of one leaf — how many points its operator can step
 * back on a series — or `undefined` when the depth is not config-derivable.
 *
 * `Moving` walks up to `lookbackBars + 1` points; `Comparison` / `State` are
 * snapshot tests resolved through `asOf` (depth 1); `Crossing` / `Channel`
 * walk back to the first non-flat / off-boundary baseline, a data-dependent,
 * genuinely unbounded depth with no value in the rule config to bound it
 * (design §2 / §A).
 *
 * The `switch` is exhaustive over {@link LeafConditionFamily} with no
 * `default`, so a new family is a compile error forcing an explicit
 * derivable/unbounded decision (design §10).
 */
export function operatorWalkDepth(leaf: LeafCondition): number | undefined {
  switch (leaf.family) {
    case LeafConditionFamily.Moving:
      return leaf.lookbackBars + 1;
    case LeafConditionFamily.Comparison:
      return 1;
    case LeafConditionFamily.State:
      return 1;
    case LeafConditionFamily.Crossing:
      return undefined;
    case LeafConditionFamily.Channel:
      return undefined;
  }
}

/**
 * The max resident bar count per period, derived from the profile **before**
 * a streamed run so the sliding window can never be too small at read time —
 * or `undefined` when any leaf's operator has a non-derivable (unbounded)
 * lookback, in which case the caller routes the profile to the eager path
 * (design §2 / §A of `docs/designs/streaming-backtest-feed.md`).
 *
 * Two contributors compound per period: the max {@link operatorWalkDepth}
 * over every rule leaf evaluated at that period, plus the max indicator
 * warmup over the profile's attached instances — an indicator operand pays
 * both the walk *and* the warmup behind it. The sum is rounded up through
 * {@link roundToPage}.
 *
 * A leaf pinned to an `interval` contributes to that period only. A leaf
 * without one is resolved against the firing period at evaluation time (an
 * interval-agnostic `Price` operand may read any observed period's series),
 * so its depth contributes to **every** active period — over-sizing is safe,
 * under-sizing would underflow the Phase 1 window. An indicator instance
 * carries no period (it is computed at each of the symbol's active periods),
 * so its warmup likewise contributes to every active period.
 *
 * @param profile - the profile whose attached indicator instances contribute warmup.
 * @param rules - the profile's rules whose condition leaves contribute walk depth.
 * @param registry - resolves each instance's module for its `warmup(inputs)`.
 * @param activePeriods - the symbol's active periods the run replays.
 */
export function deriveMaxLookback(
  profile: Profile,
  rules: Rule[],
  registry: IndicatorRegistry,
  activePeriods: Period[],
): MaxLookbackByPeriod | undefined {
  const walkDepth = new Map<Period, number>();
  const warmupDepth = new Map<Period, number>();

  for (const rule of rules) {
    for (const leaf of leavesOf(rule.condition)) {
      const depth = operatorWalkDepth(leaf);
      if (depth === undefined) return undefined;
      for (const period of leaf.interval === undefined ? activePeriods : [leaf.interval]) {
        bump(walkDepth, period, depth);
      }
    }
  }

  for (const instance of profile.indicators) {
    const module = registry.get(instance.indicatorKey);
    const warmup = module?.warmup
      ? module.warmup(instance.inputs as Parameters<NonNullable<typeof module.warmup>>[0])
      : 0;
    for (const period of activePeriods) bump(warmupDepth, period, warmup);
  }

  const perPeriod: MaxLookbackByPeriod = new Map();
  for (const period of new Set([...walkDepth.keys(), ...warmupDepth.keys()])) {
    perPeriod.set(
      period,
      roundToPage((walkDepth.get(period) ?? 0) + (warmupDepth.get(period) ?? 0)),
    );
  }
  return perPeriod;
}

/**
 * Raise `map`'s entry for `period` to at least `bars` (max-accumulate).
 */
function bump(map: Map<Period, number>, period: Period, bars: number): void {
  map.set(period, Math.max(map.get(period) ?? 0, bars));
}

/**
 * Every leaf of a rule's condition tree, in depth-first order — the array
 * form of {@link walkLeaves} so the caller can early-return mid-enumeration.
 */
function leavesOf(condition: ConditionNode): LeafCondition[] {
  const leaves: LeafCondition[] = [];
  walkLeaves(condition, (leaf) => leaves.push(leaf));
  return leaves;
}
