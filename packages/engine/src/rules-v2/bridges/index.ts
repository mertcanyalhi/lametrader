/**
 * Public surface of the rules-v2 bridges — adapters that translate upstream
 * data-source events into rules-v2 `EvaluationTriggerEvent`s.
 * The orchestrator (#393) wires them to their respective sources.
 */

export { BarLifecycleBridge } from './bar-lifecycle-bridge.js';
export { IndicatorCascadeBridge } from './indicator-cascade-bridge.js';
export { StateCascadeBridge } from './state-cascade-bridge.js';
export { TickBridge } from './tick-bridge.js';
