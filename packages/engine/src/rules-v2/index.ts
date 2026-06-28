/**
 * Public surface of the rules-v2 engine module.
 *
 * Currently exposes the history surface (series store) + the
 * `EvaluationContext` interface — the read-side every v2 operator consumes.
 * Subsequent slices (#391-#395) add operators, bridges, orchestrator,
 * persistence, and the REST surface on top of this layer.
 */

export { type BarAxis, BarSeriesView } from './bar-series-view.js';
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
