/**
 * Public surface of the rules-v2 engine module.
 *
 * Exposes the history surface (series store), the `EvaluationContext`
 * interface (the read-side every v2 operator consumes), the v2 operators,
 * and the v2 persistence adapters (`RuleRepository` / `EventLog` —
 * in-memory + Mongo).
 * Subsequent slices add bridges, orchestrator, and the REST surface on top
 * of this layer.
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
export { InMemoryEventLog } from './persistence/in-memory-event-log.js';
export { InMemoryRuleRepository } from './persistence/in-memory-rule-repository.js';
export { MongoEventLog } from './persistence/mongo-event-log.js';
export { MongoRuleRepository } from './persistence/mongo-rule-repository.js';
export type { RuleV2Document } from './persistence/mongo-rule-repository.types.js';
export type { SeriesPoint, SeriesView } from './series.types.js';
export { TICK_RING_CAPACITY, TickRing } from './tick-ring.js';
