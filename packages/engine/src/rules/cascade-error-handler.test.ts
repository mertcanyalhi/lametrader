import { type EventLog, type RuleEventEntry, RuleEventKind, RuleEventType } from '@lametrader/core';
import { afterEach, describe, expect, it } from 'vitest';

import { _resetLogRoot } from '../log.js';
import { handleCascadeError } from './cascade-error-handler.js';
import { InMemoryEventLog } from './in-memory-event-log.js';

/**
 * Unit tests for {@link handleCascadeError} — the single helper called by
 * the serialized rule chain when `orchestrator.process` rejects (#290).
 *
 * Per #306 the handler now logs through the engine's shared Pino logger;
 * each test installs a destination stream via {@link _resetLogRoot} to
 * capture emitted records.
 */

/**
 * Decode the raw line Pino writes onto the destination stream into the
 * structured record we want to assert against.
 */
function parseRecord(line: string): Record<string, unknown> {
  return JSON.parse(line);
}

/**
 * Install a fresh recording destination, return the array the test will
 * assert against, plus a getter for the records emitted so far.
 */
function recordingDestination(): { records: Record<string, unknown>[] } {
  const records: Record<string, unknown>[] = [];
  _resetLogRoot({
    write: (line: string) => {
      records.push(parseRecord(line));
    },
  });
  return { records };
}

describe('handleCascadeError', () => {
  afterEach(() => {
    _resetLogRoot();
  });

  it('logs the primary error at level error with { err, event } and the canonical message', async () => {
    const eventLog = new InMemoryEventLog();
    const { records } = recordingDestination();
    const err = new Error('boom');
    const event = {
      kind: RuleEventKind.CurrentValueChanged as const,
      ts: 1000,
      symbolId: 'AAPL',
      prev: null,
      current: 100,
      final: false,
    };

    await handleCascadeError(err, event, eventLog);

    expect(records[0]).toEqual({
      level: 50,
      time: expect.any(Number),
      app: 'engine',
      scope: 'cascade-error-handler',
      err: { type: 'Error', message: 'boom', stack: expect.any(String) },
      event,
      msg: 'rule orchestration failed',
    });
  });

  it('appends a synthetic Error rule event to the affected symbol when the event carries a symbolId', async () => {
    const eventLog = new InMemoryEventLog(() => 999);
    recordingDestination();
    const err = new Error('boom');
    const event = {
      kind: RuleEventKind.CurrentValueChanged as const,
      ts: 1000,
      symbolId: 'AAPL',
      prev: null,
      current: 100,
      final: false,
    };

    await handleCascadeError(err, event, eventLog);

    expect(await eventLog.symbolEvents('AAPL')).toEqual<RuleEventEntry[]>([
      {
        type: RuleEventType.Error,
        ts: 1000,
        ruleId: '',
        symbolId: 'AAPL',
        reason: 'rule orchestration failed: boom',
        firedAt: 999,
      },
    ]);
  });

  it('logs the secondary failure and resolves when the synthetic-event write itself throws', async () => {
    const { records } = recordingDestination();
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

    await expect(handleCascadeError(err, event, failingLog)).resolves.toBeUndefined();

    expect(records.map((r) => r.msg)).toEqual([
      'rule orchestration failed',
      'failed to write cascade error event',
    ]);
  });

  it('only logs (no synthetic event) when the rejecting event has no symbolId', async () => {
    const eventLog = new InMemoryEventLog();
    const { records } = recordingDestination();
    const err = new Error('boom');
    const event = { kind: RuleEventKind.Timer as const, ts: 1000, symbolId: null };

    await handleCascadeError(err, event, eventLog);

    expect({
      messages: records.map((r) => r.msg),
      symbolEvents: await eventLog.symbolEvents('AAPL'),
    }).toEqual({
      messages: ['rule orchestration failed'],
      symbolEvents: [],
    });
  });
});
