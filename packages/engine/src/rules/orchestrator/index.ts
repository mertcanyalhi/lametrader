/**
 * Public surface of the rules orchestrator + action runner.
 *
 * Composes the dispatcher (#391) + bridges (#392) + condition operators
 * (#390) + series store (#389) + core types (#388) into an end-to-end engine
 * on top of the standalone {@link EventLog} port (the v2 rule doc
 * no longer carries an embedded `events[]` array).
 */

export { ActionRunner } from './action-runner.js';
export { CycleGuard, CycleOverflowError } from './cycle-guard.js';
export { InMemoryEventLog } from './in-memory-event-log.js';
export { MongoEventLog } from './mongo-event-log.js';
export {
  RuleOrchestrator,
  type RuleOrchestratorDeps,
  type RuleOrchestratorOptions,
} from './orchestrator.js';
export { RuleOutcome } from './orchestrator-trace.types.js';
export { createPerSymbolSerializer } from './per-symbol-serializer.js';
