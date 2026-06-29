import {
  type EvaluationTriggerEvent,
  EvaluationTriggerKind,
  type GlobalStateChangedEvent,
  type StateChangedEvent,
  StateScope,
  type SymbolStateChangedEvent,
} from '@lametrader/core';

import { getLogger } from '../../log.js';

/**
 * Scope-bound logger for every cascade bridge — emits a single
 * `bridge_emit` trace per outbound `EvaluationTriggerEvent` (per #436 /
 * spec rules-trace-scope-logging).
 */
const log = getLogger('engine.rules.bridges');

/**
 * Bridges {@link StateRepository}'s {@link StateChangedEvent}s into rules
 * cascade triggers — {@link SymbolStateChangedEvent} or
 * {@link GlobalStateChangedEvent} per the inbound scope.
 *
 * Preserves v1's cascade re-entry semantics (a state mutation re-triggers
 * evaluation in the same tick) and carries `profileId` through so the
 * orchestrator can scope cascades to same-profile candidates (#281).
 */
export class StateCascadeBridge {
  /**
   * @param emit - the `EvaluationTriggerEvent` sink (typically the
   *   orchestrator's enqueue).
   */
  constructor(private readonly emit: (event: EvaluationTriggerEvent) => void) {}

  /**
   * React to one inbound {@link StateChangedEvent} and emit the matching
   * scope-tagged rules cascade trigger.
   */
  handleStateChange(event: StateChangedEvent): void {
    const outbound: SymbolStateChangedEvent | GlobalStateChangedEvent =
      event.scope.kind === StateScope.Symbol
        ? {
            kind: EvaluationTriggerKind.SymbolStateChanged,
            ts: event.ts,
            symbolId: event.scope.symbolId,
            profileId: event.profileId,
            key: event.key,
            prev: event.prev,
            current: event.current,
          }
        : {
            kind: EvaluationTriggerKind.GlobalStateChanged,
            ts: event.ts,
            profileId: event.profileId,
            key: event.key,
            prev: event.prev,
            current: event.current,
          };
    this.emit(outbound);
    if (log.isLevelEnabled('trace')) {
      log.trace(
        {
          bridge: 'state-cascade',
          inboundEventKind: 'state-changed',
          emittedEventKind: outbound.kind,
          payload: outbound,
        },
        'bridge_emit',
      );
    }
  }
}
