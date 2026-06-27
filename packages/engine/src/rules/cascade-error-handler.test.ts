import { type EventLog, type RuleEventEntry, RuleEventKind, RuleEventType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { handleCascadeError } from './cascade-error-handler.js';
import { InMemoryEventLog } from './in-memory-event-log.js';

/**
 * Unit tests for {@link handleCascadeError} — the single helper called by
 * the serialized rule chain when `orchestrator.process` rejects (#290).
 *
 * Each test builds a stub Pino-shaped logger and observes its calls plus
 * the side-effect on the {@link EventLog}.
 */

/**
 * The subset of Pino's API the helper uses, plus a recorder for tests.
 */
interface RecordingLogger {
  error: (context: { err: unknown; event?: unknown }, message: string) => void;
  calls: Array<{ context: { err: unknown; event?: unknown }; message: string }>;
}

/** Build a fresh recording logger. */
function recordingLogger(): RecordingLogger {
  const calls: RecordingLogger['calls'] = [];
  return {
    error: (context, message) => {
      calls.push({ context, message });
    },
    calls,
  };
}

describe('handleCascadeError', () => {
  it('logs the primary error at level error with { err, event } and the canonical message', async () => {
    const log = new InMemoryEventLog();
    const logger = recordingLogger();
    const err = new Error('boom');
    const event = {
      kind: RuleEventKind.CurrentValueChanged as const,
      ts: 1000,
      symbolId: 'AAPL',
      prev: null,
      current: 100,
      final: false,
    };

    await handleCascadeError(err, event, log, logger);

    expect(logger.calls[0]).toEqual({
      context: { err, event },
      message: 'rule orchestration failed',
    });
  });

  it('appends a synthetic Error rule event to the affected symbol when the event carries a symbolId', async () => {
    const log = new InMemoryEventLog();
    const logger = recordingLogger();
    const err = new Error('boom');
    const event = {
      kind: RuleEventKind.CurrentValueChanged as const,
      ts: 1000,
      symbolId: 'AAPL',
      prev: null,
      current: 100,
      final: false,
    };

    await handleCascadeError(err, event, log, logger);

    expect(await log.symbolEvents('AAPL')).toEqual<RuleEventEntry[]>([
      {
        type: RuleEventType.Error,
        ts: 1000,
        ruleId: '',
        symbolId: 'AAPL',
        reason: 'rule orchestration failed: boom',
      },
    ]);
  });

  it('logs the secondary failure and resolves when the synthetic-event write itself throws', async () => {
    const logger = recordingLogger();
    const writeErr = new Error('mongo write failed');
    const failingLog: EventLog = {
      appendSymbolEvent: () => Promise.reject(writeErr),
      appendRuleEvent: () => Promise.resolve(),
      symbolEvents: () => Promise.resolve([]),
      ruleEvents: () => Promise.resolve([]),
    };
    const err = new Error('boom');
    const event = {
      kind: RuleEventKind.CurrentValueChanged as const,
      ts: 1000,
      symbolId: 'AAPL',
      prev: null,
      current: 100,
      final: false,
    };

    await expect(handleCascadeError(err, event, failingLog, logger)).resolves.toBeUndefined();

    expect(logger.calls).toEqual([
      { context: { err, event }, message: 'rule orchestration failed' },
      { context: { err: writeErr }, message: 'failed to write cascade error event' },
    ]);
  });

  it('only logs (no synthetic event) when the rejecting event has no symbolId', async () => {
    const log = new InMemoryEventLog();
    const logger = recordingLogger();
    const err = new Error('boom');
    const event = { kind: RuleEventKind.Timer as const, ts: 1000, symbolId: null };

    await handleCascadeError(err, event, log, logger);

    expect({ calls: logger.calls.length, symbolEvents: await log.symbolEvents('AAPL') }).toEqual({
      calls: 1,
      symbolEvents: [],
    });
  });
});
