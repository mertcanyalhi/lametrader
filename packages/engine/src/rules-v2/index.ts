/**
 * Public surface of the rules-v2 engine module.
 *
 * Exposes the history surface (series store), the `EvaluationContext`
 * interface, the operator implementations, and the dispatch layer
 * (`TriggerDispatcher` + `IntervalScheduler`).
 * Subsequent slices (#392-#395) add bridges, orchestrator, persistence, and
 * the REST surface on top of this layer.
 */

export { type BarAxis, BarSeriesView } from './bar-series-view.js';
export {
  BarLifecycleBridge,
  IndicatorCascadeBridge,
  StateCascadeBridge,
  TickBridge,
} from './bridges/index.js';
export {
  type DispatchOptions,
  evaluateCondition,
  type FireRecord,
  InMemoryRuleRepository,
  type IntervalEmit,
  IntervalScheduler,
  referencesSlot,
  routes,
  TriggerDispatcher,
  type TriggerDispatcherDeps,
} from './dispatch/index.js';
export {
  barSeriesKey,
  buildEvaluationContext,
  type EvaluationContextDeps,
  prewarmBarSeries,
} from './evaluation-context.js';
export type { EvaluationContext } from './evaluation-context.types.js';
export {
  ArraySeriesView,
  IndicatorSeriesStore,
  type IndicatorWarmupRequest,
} from './indicator-series-store.js';
export {
  evaluateChannel,
  evaluateComparison,
  evaluateCrossing,
  evaluateLeaf,
  evaluateMoving,
  evaluateState,
} from './operators/index.js';
export type { SeriesPoint, SeriesView } from './series.types.js';
export { TICK_RING_CAPACITY, TickRing } from './tick-ring.js';
