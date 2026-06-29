/**
 * Public surface of the rules dispatch module.
 *
 * Pure routing + per-trigger gating. The orchestrator composes
 * `TriggerDispatcher` + `IntervalScheduler` + `InMemoryRuleRepository` (or
 * `MongoRuleRepository`) into a working engine.
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
export { MongoRuleRepository } from './mongo-rule-repository.js';
export type { RuleDocument } from './mongo-rule-repository.types.js';
export { referencesSlot } from './references-slot.js';
export { routes } from './routes.js';
