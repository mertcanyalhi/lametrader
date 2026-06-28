/**
 * Public surface of the rules-v2 dispatch module.
 *
 * Pure routing + per-trigger gating. The orchestrator (#393) composes
 * `TriggerDispatcher` + `IntervalScheduler` + `InMemoryRuleRepository` (or
 * the Mongo adapter from #394) into a working engine.
 */

export {
  type DispatchOptions,
  type FireRecord,
  TriggerDispatcher,
  type TriggerDispatcherDeps,
} from './dispatcher.js';
export { evaluateCondition } from './evaluate-condition.js';
export { InMemoryRuleRepository } from './in-memory-rule-repository.js';
export { type IntervalEmit, IntervalScheduler } from './interval-scheduler.js';
export { referencesSlot } from './references-slot.js';
export { routes } from './routes.js';
