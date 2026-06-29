/**
 * v2 rules live wiring — composes the orchestrator + dispatcher + bridges
 * into a single chain plugged into the existing quote / candle / indicator
 * streams, alongside v1.
 */

export {
  type InitialStateEntry,
  LiveEvaluationLookupsV2,
} from './live-evaluation-lookups-v2.js';
export {
  feedCandleIntoEngineV2,
  type RuleEngineV2Deps,
  type WiredRuleEngineV2,
  wireRuleEngineV2,
} from './wire-rule-engine-v2.js';
