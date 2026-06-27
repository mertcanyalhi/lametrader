import {
  type RuleEventEntry,
  RuleEventType,
  type StateRemovedRuleEvent,
  type StateSetRuleEvent,
} from './rule.types.js';

/**
 * Filter the subset of `symbol.events` whose `type` is `StateSet` or
 * `StateRemoved` — the surface the chart consumes to render state-change
 * annotations.
 *
 * Reads from `Symbol.events[]` (already populated per ADR 0012); no new
 * collection or denormalized history surface. Original order is preserved.
 *
 * @param symbol - any object exposing the embedded events log; `events`
 *   missing or empty returns `[]`.
 */
export function listSymbolStateEvents(symbol: {
  events?: RuleEventEntry[];
}): (StateSetRuleEvent | StateRemovedRuleEvent)[] {
  if (symbol.events === undefined || symbol.events.length === 0) return [];
  return symbol.events.filter(isStateEvent);
}

/**
 * Narrow a {@link RuleEventEntry} to the state-mutation subset.
 */
function isStateEvent(entry: RuleEventEntry): entry is StateSetRuleEvent | StateRemovedRuleEvent {
  return entry.type === RuleEventType.StateSet || entry.type === RuleEventType.StateRemoved;
}
