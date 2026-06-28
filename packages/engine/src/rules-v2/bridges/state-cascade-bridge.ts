import { RulesV2, type StateChangedEvent, StateScope } from '@lametrader/core';

/**
 * Bridges {@link StateRepository}'s {@link StateChangedEvent}s into rules-v2
 * cascade triggers — {@link RulesV2.SymbolStateChangedEvent} or
 * {@link RulesV2.GlobalStateChangedEvent} per the inbound scope.
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
  constructor(private readonly emit: (event: RulesV2.EvaluationTriggerEvent) => void) {}

  /**
   * React to one inbound {@link StateChangedEvent} and emit the matching
   * scope-tagged rules-v2 cascade trigger.
   */
  handleStateChange(event: StateChangedEvent): void {
    if (event.scope.kind === StateScope.Symbol) {
      this.emit({
        kind: RulesV2.EvaluationTriggerKind.SymbolStateChanged,
        ts: event.ts,
        symbolId: event.scope.symbolId,
        profileId: event.profileId,
        key: event.key,
        prev: event.prev,
        current: event.current,
      });
      return;
    }
    this.emit({
      kind: RulesV2.EvaluationTriggerKind.GlobalStateChanged,
      ts: event.ts,
      profileId: event.profileId,
      key: event.key,
      prev: event.prev,
      current: event.current,
    });
  }
}
