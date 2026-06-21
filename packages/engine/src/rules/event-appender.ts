import {
  ActionKind,
  type EventLog,
  type RuleEventEntry,
  RuleEventType,
  StateScope,
} from '@lametrader/core';
import type { StateMutationAction } from './state-action-executor.js';

/**
 * Append one {@link RuleEventEntry} for a state-mutation action to BOTH the
 * rule's embedded events log AND the affected symbol's embedded events log
 * (per ADR 0012).
 *
 * Picks the right event variant from the action's `kind`:
 * - `SetSymbolState` / `SetGlobalState` → `StateSet` event with `scope` +
 *   `key` + `value`.
 * - `RemoveSymbolState` / `RemoveGlobalState` → `StateRemoved` event with
 *   `scope` + `key`.
 */
export async function appendStateActionEvent(
  action: StateMutationAction,
  ruleId: string,
  firingSymbolId: string,
  ts: number,
  log: EventLog,
): Promise<void> {
  const entry = buildEntry(action, ruleId, firingSymbolId, ts);
  await log.appendRuleEvent(ruleId, entry);
  await log.appendSymbolEvent(firingSymbolId, entry);
}

/**
 * Build the typed {@link RuleEventEntry} for one state-mutation action.
 */
function buildEntry(
  action: StateMutationAction,
  ruleId: string,
  symbolId: string,
  ts: number,
): RuleEventEntry {
  switch (action.kind) {
    case ActionKind.SetSymbolState:
      return {
        type: RuleEventType.StateSet,
        ts,
        ruleId,
        symbolId,
        scope: StateScope.Symbol,
        key: action.key,
        value: action.value,
      };
    case ActionKind.SetGlobalState:
      return {
        type: RuleEventType.StateSet,
        ts,
        ruleId,
        symbolId,
        scope: StateScope.Global,
        key: action.key,
        value: action.value,
      };
    case ActionKind.RemoveSymbolState:
      return {
        type: RuleEventType.StateRemoved,
        ts,
        ruleId,
        symbolId,
        scope: StateScope.Symbol,
        key: action.key,
      };
    case ActionKind.RemoveGlobalState:
      return {
        type: RuleEventType.StateRemoved,
        ts,
        ruleId,
        symbolId,
        scope: StateScope.Global,
        key: action.key,
      };
  }
}
