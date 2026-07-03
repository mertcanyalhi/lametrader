/**
 * Public surface of the rules engine module.
 *
 * Exposes the history surface (series store), the `EvaluationContext`
 * interface, the operator implementations, the dispatch layer
 * (`TriggerDispatcher` + `IntervalScheduler`), the orchestrator, the
 * persistence ports, and the REST-facing service.
 */

export { type BarAxis, BarSeriesView } from './bar-series-view.js';
export {
  BarLifecycleBridge,
  IndicatorCascadeBridge,
  StateCascadeBridge,
} from './bridges/index.js';
export {
  type DispatchOptions,
  evaluateCondition,
  type FireRecord,
  InMemoryRuleRepository,
  type IntervalEmit,
  IntervalScheduler,
  MongoRuleRepository,
  type RuleDocument,
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
export {
  ActionRunner,
  CycleGuard,
  CycleOverflowError,
  createPerSymbolSerializer,
  InMemoryEventLog,
  MongoEventLog,
  RuleOrchestrator,
  type RuleOrchestratorDeps,
  type RuleOrchestratorOptions,
  RuleOutcome,
} from './orchestrator/index.js';
export type { SeriesPoint, SeriesView } from './series.types.js';
export {
  type EventListOptions,
  type RuleCreateInput,
  type RuleListFilters,
  RuleService,
  type RuleServiceOptions,
} from './service/index.js';
export {
  feedCandleIntoEngine,
  type InitialStateEntry,
  LiveEvaluationLookups,
  type RuleEngineDeps,
  type WiredRuleEngine,
  wireRuleEngine,
} from './wire/index.js';
