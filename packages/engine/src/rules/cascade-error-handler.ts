import {
  type EventLog,
  type RuleEvent,
  type RuleEventEntry,
  RuleEventType,
} from '@lametrader/core';

/**
 * The subset of Pino's API the cascade error handler consumes — a single
 * `error(context, message)` call. Captured as a structural interface so the
 * unit tests can pass a recording stand-in (and so the engine layer doesn't
 * pull `pino` as a hard dependency).
 */
export interface CascadeErrorLogger {
  /**
   * Log an `error`-level entry; matches Pino's two-argument signature.
   *
   * @param context - structured fields (Pino's `err` key triggers its
   *   error serializer).
   * @param message - the human-readable log message.
   */
  error(context: { err: unknown; event?: unknown }, message: string): void;
}

/**
 * Handle one cascade failure from the serialized rule chain (#290).
 *
 * Logs the primary error via `logger.error`. When the rejecting `event`
 * carries a `symbolId`, additionally appends a synthetic `Error` rule event
 * to that symbol's `events[]` via `log.appendSymbolEvent` so the failure
 * surfaces in the chart's existing Events dialog. Uses `ruleId: ''` as the
 * orchestrator-level sentinel, matching the `CycleOverflow` convention from
 * {@link RuleOrchestrator}.
 *
 * The synthetic-event write is itself wrapped in a try/catch — if writing
 * also throws, the secondary failure is logged but never re-thrown, so the
 * cascade handler can't propagate exceptions out of the rule chain.
 *
 * @param err - the error the orchestrator rejected with.
 * @param event - the `RuleEvent` that was being processed.
 * @param log - the event log to append the synthetic `Error` event to.
 * @param logger - the structured logger to record the failure on.
 */
export async function handleCascadeError(
  err: unknown,
  event: RuleEvent,
  log: EventLog,
  logger: CascadeErrorLogger,
): Promise<void> {
  logger.error({ err, event }, 'rule orchestration failed');
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
    await log.appendSymbolEvent(event.symbolId, entry);
  } catch (writeErr) {
    logger.error({ err: writeErr }, 'failed to write cascade error event');
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
