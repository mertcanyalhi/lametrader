import {
  ActionKind,
  type Notifier,
  RuleEventKind,
  RuleEventType,
  StateValueType,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { buildEvaluationContext } from './evaluation-context.js';
import type { EvaluationLookups } from './evaluation-context.types.js';
import { InMemoryEventLog } from './in-memory-event-log.js';
import { InMemoryNotifier } from './in-memory-notifier.js';
import { executeTelegramAction } from './telegram-action-executor.js';

/** Baseline lookups returning null for everything (sufficient for these tests). */
function emptyLookups(): EvaluationLookups {
  return {
    getCurrentValue: () => null,
    getOpenValue: () => null,
    getHighValue: () => null,
    getLowValue: () => null,
    getCloseValue: () => null,
    getVolumeValue: () => null,
    getIndicatorValue: () => null,
    getSymbolState: () => null,
    getGlobalState: () => null,
  };
}

const sampleContext = () =>
  buildEvaluationContext(
    {
      kind: RuleEventKind.CurrentValueChanged,
      ts: 1000,
      symbolId: 'AAPL',
      prev: 99,
      current: 100,
      final: false,
    },
    emptyLookups(),
  );

describe('executeTelegramAction — happy path', () => {
  it('renders the template, calls the notifier, and appends a NotificationSent event to both logs', async () => {
    const notifier = new InMemoryNotifier(['main']);
    const log = new InMemoryEventLog(() => 999);
    await executeTelegramAction(
      {
        kind: ActionKind.NotifyTelegram,
        destinationName: 'main',
        template: '{symbolId} crossed {current} (prev {prev}) @ {ts}',
      },
      sampleContext(),
      'rule-1',
      'AAPL',
      1000,
      notifier,
      log,
    );
    expect(notifier.sent).toEqual([
      { destinationName: 'main', body: 'AAPL crossed 100 (prev 99) @ 1000' },
    ]);
    const expectedEntry = {
      type: RuleEventType.NotificationSent,
      ts: 1000,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
      destinationName: 'main',
      body: 'AAPL crossed 100 (prev 99) @ 1000',
      firedAt: 999,
    };
    expect(await log.ruleEvents('rule-1')).toEqual([expectedEntry]);
    expect(await log.symbolEvents('AAPL')).toEqual([expectedEntry]);
  });
});

describe('executeTelegramAction — unknown template token', () => {
  it('does not call the notifier and appends an Error event naming the bad token', async () => {
    const notifier = new InMemoryNotifier(['main']);
    const log = new InMemoryEventLog(() => 999);
    await executeTelegramAction(
      {
        kind: ActionKind.NotifyTelegram,
        destinationName: 'main',
        template: 'hello {nope}',
      },
      sampleContext(),
      'rule-1',
      'AAPL',
      1000,
      notifier,
      log,
    );
    expect(notifier.sent).toEqual([]);
    const expectedEntry = {
      type: RuleEventType.Error,
      ts: 1000,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
      reason: 'unknown template token: {nope}',
      firedAt: 999,
    };
    expect(await log.ruleEvents('rule-1')).toEqual([expectedEntry]);
    expect(await log.symbolEvents('AAPL')).toEqual([expectedEntry]);
  });
});

describe('executeTelegramAction — unknown destination', () => {
  it('appends an Error event identifying the missing destination', async () => {
    const notifier = new InMemoryNotifier(['main']);
    const log = new InMemoryEventLog(() => 999);
    await executeTelegramAction(
      {
        kind: ActionKind.NotifyTelegram,
        destinationName: 'missing',
        template: 'hi',
      },
      sampleContext(),
      'rule-1',
      'AAPL',
      1000,
      notifier,
      log,
    );
    expect(notifier.sent).toEqual([]);
    expect(await log.ruleEvents('rule-1')).toEqual([
      {
        type: RuleEventType.Error,
        ts: 1000,
        ruleId: 'rule-1',
        symbolId: 'AAPL',
        reason: 'Unknown notifier destination: missing',
        firedAt: 999,
      },
    ]);
  });
});

describe('executeTelegramAction — transport failure', () => {
  it('appends an Error event with the thrown error message', async () => {
    const notifier: Notifier = {
      async send() {
        throw new Error('telegram api down');
      },
    };
    const log = new InMemoryEventLog(() => 999);
    await executeTelegramAction(
      {
        kind: ActionKind.NotifyTelegram,
        destinationName: 'main',
        template: 'hi',
      },
      sampleContext(),
      'rule-1',
      'AAPL',
      1000,
      notifier,
      log,
    );
    expect(await log.ruleEvents('rule-1')).toEqual([
      {
        type: RuleEventType.Error,
        ts: 1000,
        ruleId: 'rule-1',
        symbolId: 'AAPL',
        reason: 'telegram api down',
        firedAt: 999,
      },
    ]);
  });
});

describe('executeTelegramAction — template variables', () => {
  it('stringifies null prev/current to empty strings', async () => {
    const notifier = new InMemoryNotifier(['main']);
    const log = new InMemoryEventLog(() => 999);
    const context = buildEvaluationContext(
      { kind: RuleEventKind.Timer, ts: 1000, symbolId: null },
      emptyLookups(),
    );
    await executeTelegramAction(
      {
        kind: ActionKind.NotifyTelegram,
        destinationName: 'main',
        template: '[{prev}]→[{current}]',
      },
      context,
      'rule-1',
      'AAPL',
      1000,
      notifier,
      log,
    );
    expect(notifier.sent).toEqual([{ destinationName: 'main', body: '[]→[]' }]);
  });

  it('renders non-Number StateValue prev/current using their wrapped value', async () => {
    const notifier = new InMemoryNotifier(['main']);
    const log = new InMemoryEventLog(() => 999);
    const context = buildEvaluationContext(
      {
        kind: RuleEventKind.SymbolStateChanged,
        ts: 1000,
        symbolId: 'AAPL',
        key: 'trend',
        prev: { type: StateValueType.Enum, value: 'down' },
        current: { type: StateValueType.Enum, value: 'up' },
      },
      emptyLookups(),
    );
    await executeTelegramAction(
      {
        kind: ActionKind.NotifyTelegram,
        destinationName: 'main',
        template: '{prev}→{current}',
      },
      context,
      'rule-1',
      'AAPL',
      1000,
      notifier,
      log,
    );
    expect(notifier.sent).toEqual([{ destinationName: 'main', body: 'down→up' }]);
  });
});
