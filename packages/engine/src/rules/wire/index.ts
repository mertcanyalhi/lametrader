/**
 * Live wiring for the rules engine — composes the orchestrator + dispatcher
 * + bridges into a single chain plugged into the existing quote / candle /
 * indicator streams.
 */

export {
  type InitialStateEntry,
  LiveEvaluationLookups,
} from './live-evaluation-lookups.js';
export {
  feedCandleIntoEngine,
  type RuleEngineDeps,
  type WiredRuleEngine,
  wireRuleEngine,
} from './wire-rule-engine.js';
