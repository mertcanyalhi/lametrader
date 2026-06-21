import { type RuleEventEntry, RuleEventType } from '@lametrader/core';

/**
 * The `Once` trigger gate.
 *
 * Returns `true` when the rule may fire on `symbolId` — i.e. no prior `Fired`
 * event exists on the rule's embedded events log for that `symbolId`.
 *
 * The events log is part of the persisted {@link Rule} entity (ADR 0012), so
 * the survives-restart guarantee comes for free from the rule persistence
 * adapter — no separate firing-state store is needed.
 *
 * Lazy: a pure read over the rule's events. Recording a new firing is done by
 * the action executor (#126) when it appends a `Fired` entry.
 */
export function mayFireOnce(events: RuleEventEntry[], symbolId: string): boolean {
  for (const event of events) {
    if (event.type === RuleEventType.Fired && event.symbolId === symbolId) return false;
  }
  return true;
}
