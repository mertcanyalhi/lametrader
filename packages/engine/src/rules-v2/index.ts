/**
 * Public surface of the v2 rule-engine, re-exported from `@lametrader/engine`
 * as `RulesV2` so v1 and v2 symbols coexist behind the feature flag (per
 * ADR 0016).
 */

export {
  ActionRunner,
  CycleGuard,
  CycleOverflowError,
  createPerSymbolSerializer,
  InMemoryEventLog,
  InMemoryRuleRepository,
  RuleOrchestrator,
  type RuleOrchestratorOptions,
  RuleOutcome,
  type RunActionsInput,
} from './orchestrator/index.js';
export { MongoEventLog } from './persistence/mongo-event-log.js';
export { MongoRuleRepository } from './persistence/mongo-rule-repository.js';
export type { RuleV2Document } from './persistence/mongo-rule-repository.types.js';
