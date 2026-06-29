/**
 * Public surface of the rules bridges — adapters that translate upstream
 * data-source events into rules `EvaluationTriggerEvent`s.
 * The orchestrator (#393) wires them to their respective sources.
 */

export { BarLifecycleBridge } from './bar-lifecycle-bridge.js';
export { IndicatorCascadeBridge } from './indicator-cascade-bridge.js';
export { StateCascadeBridge } from './state-cascade-bridge.js';
export { TickBridge } from './tick-bridge.js';
