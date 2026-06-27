import {
  type EventLog,
  type RuleEvent,
  type RuleEventEntry,
  RuleEventType,
} from '@lametrader/core';

import { getLogger } from '../log.js';

/**
 * Scope-bound logger for the cascade error handler. Mirrors the per-module
 * pattern in the rest of the engine — the scope appears on every entry so
 * the handler's logs can be filtered out of the stream.
 */
const log = getLogger('cascade-error-handler');

/**
 * Handle one cascade failure from the serialized rule chain (#290).
 *
 * Logs the primary error via the engine's shared Pino logger. When the
 * rejecting `event` carries a `symbolId`, additionally appends a synthetic
 * `Error` rule event to that symbol's `events[]` via `log.appendSymbolEvent`
 * so the failure surfaces in the chart's existing Events dialog. Uses
 * `ruleId: ''` as the orchestrator-level sentinel, matching the
 * `CycleOverflow` convention from {@link RuleOrchestrator}.
 *
 * The synthetic-event write is itself wrapped in a try/catch — if writing
 * also throws, the secondary failure is logged but never re-thrown, so the
 * cascade handler can't propagate exceptions out of the rule chain.
 *
 * @param err - the error the orchestrator rejected with.
 * @param event - the `RuleEvent` that was being processed.
 * @param eventLog - the event log to append the synthetic `Error` event to.
 */
export async function handleCascadeError(
  err: unknown,
  event: RuleEvent,
  eventLog: EventLog,
): Promise<void> {
  log.error({ err, event }, 'rule orchestration failed');
  if (event.symbolId === null) return;
  const reason = `rule orchestration failed: ${errorMessage(err)}`;
  const entry: RuleEventEntry = {
    type: RuleEventType.Error,
    ts: event.ts,
    ruleId: '',
    symbolId: event.symbolId,
    reason,
  };
  try {
    await eventLog.appendSymbolEvent(event.symbolId, entry);
  } catch (writeErr) {
    log.error({ err: writeErr }, 'failed to write cascade error event');
  }
}

/**
 * Extract the human-readable message from an unknown caught error — falls
 * back to `String(err)` so non-Error throws still surface usefully.
 */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
