import {
  EvaluationTriggerKind,
  type RuleEventEntry,
  RuleEventType,
  StateScope,
  type StateValue,
  StateValueType,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { InMemoryEventLog } from '../rules/orchestrator/in-memory-event-log.js';
import { StateHistoryService } from './state-history-service.js';

/**
 * Build a `StateSet` entry with sensible defaults so each test reads
 * declaratively.
 */
function stateSet(args: {
  ruleId: string;
  symbolId: string;
  ts: number;
  scope?: StateScope;
  key: string;
  value: StateValue;
}): RuleEventEntry {
  return {
    type: RuleEventType.StateSet,
    ruleId: args.ruleId,
    symbolId: args.symbolId,
    ts: args.ts,
    scope: args.scope ?? StateScope.Symbol,
    key: args.key,
    value: args.value,
  };
}

/**
 * Build a `StateRemoved` entry, same convenience as `stateSet`.
 */
function stateRemoved(args: {
  ruleId: string;
  symbolId: string;
  ts: number;
  scope?: StateScope;
  key: string;
}): RuleEventEntry {
  return {
    type: RuleEventType.StateRemoved,
    ruleId: args.ruleId,
    symbolId: args.symbolId,
    ts: args.ts,
    scope: args.scope ?? StateScope.Symbol,
    key: args.key,
  };
}

/**
 * Build a `Fired` umbrella entry — used as ignored noise the service must
 * skip when scanning for state-key descriptors and series points.
 */
function fired(args: { ruleId: string; symbolId: string; ts: number }): RuleEventEntry {
  return {
    type: RuleEventType.Fired,
    ruleId: args.ruleId,
    symbolId: args.symbolId,
    ts: args.ts,
    context: {
      inboundEvent: {
        kind: EvaluationTriggerKind.Tick,
        ts: args.ts,
        symbolId: args.symbolId,
        price: 0,
      },
      lookupSnapshot: {
        current: null,
        open: null,
        high: null,
        low: null,
        close: null,
        volume: null,
      },
    },
  };
}

describe('StateHistoryService.listKeys', () => {
  it('returns distinct (key, valueType) pairs from symbol-scoped StateSet entries, alphabetical by key', async () => {
    const eventLog = new InMemoryEventLog(() => 1_000);
    const symbolId = 'crypto:BTCUSDT';
    await eventLog.appendSymbolEvent(
      symbolId,
      stateSet({
        ruleId: 'rule-a',
        symbolId,
        ts: 1,
        key: 'last_signal',
        value: { type: StateValueType.String, value: 'buy' },
      }),
    );
    await eventLog.appendSymbolEvent(
      symbolId,
      stateSet({
        ruleId: 'rule-b',
        symbolId,
        ts: 2,
        key: 'cooldown',
        value: { type: StateValueType.Number, value: 5 },
      }),
    );
    // A second `StateSet` on the same key must not duplicate the descriptor.
    await eventLog.appendSymbolEvent(
      symbolId,
      stateSet({
        ruleId: 'rule-a',
        symbolId,
        ts: 3,
        key: 'last_signal',
        value: { type: StateValueType.String, value: 'sell' },
      }),
    );
    const service = new StateHistoryService(eventLog);

    const keys = await service.listKeys(symbolId);

    expect(keys).toEqual([
      { key: 'cooldown', valueType: StateValueType.Number },
      { key: 'last_signal', valueType: StateValueType.String },
    ]);
  });

  it('drops StateSet entries on StateScope.Global because global state is not symbol-keyed', async () => {
    const eventLog = new InMemoryEventLog(() => 1_000);
    const symbolId = 'crypto:BTCUSDT';
    await eventLog.appendSymbolEvent(
      symbolId,
      stateSet({
        ruleId: 'rule-a',
        symbolId,
        ts: 1,
        scope: StateScope.Global,
        key: 'global_key',
        value: { type: StateValueType.Bool, value: true },
      }),
    );
    await eventLog.appendSymbolEvent(
      symbolId,
      stateSet({
        ruleId: 'rule-b',
        symbolId,
        ts: 2,
        key: 'symbol_key',
        value: { type: StateValueType.Number, value: 1 },
      }),
    );
    const service = new StateHistoryService(eventLog);

    const keys = await service.listKeys(symbolId);

    expect(keys).toEqual([{ key: 'symbol_key', valueType: StateValueType.Number }]);
  });

  it('returns [] when the symbol has no events', async () => {
    const eventLog = new InMemoryEventLog(() => 1_000);
    const service = new StateHistoryService(eventLog);

    const keys = await service.listKeys('crypto:NOPE');

    expect(keys).toEqual([]);
  });
});

describe('StateHistoryService.series', () => {
  it('returns one entry per StateSet and one per StateRemoved for the key, ascending by ts', async () => {
    const eventLog = new InMemoryEventLog(() => 1_000);
    const symbolId = 'crypto:BTCUSDT';
    await eventLog.appendSymbolEvent(
      symbolId,
      stateSet({
        ruleId: 'rule-a',
        symbolId,
        ts: 2,
        key: 'last_signal',
        value: { type: StateValueType.String, value: 'sell' },
      }),
    );
    await eventLog.appendSymbolEvent(
      symbolId,
      stateSet({
        ruleId: 'rule-a',
        symbolId,
        ts: 1,
        key: 'last_signal',
        value: { type: StateValueType.String, value: 'buy' },
      }),
    );
    await eventLog.appendSymbolEvent(
      symbolId,
      stateRemoved({
        ruleId: 'rule-a',
        symbolId,
        ts: 3,
        key: 'last_signal',
      }),
    );
    const service = new StateHistoryService(eventLog);

    const series = await service.series(symbolId, 'last_signal', {});

    expect(series).toEqual([
      { ts: 1, value: { type: StateValueType.String, value: 'buy' } },
      { ts: 2, value: { type: StateValueType.String, value: 'sell' } },
      { ts: 3, value: null },
    ]);
  });

  it('filters by key exactly — entries for a different key are dropped', async () => {
    const eventLog = new InMemoryEventLog(() => 1_000);
    const symbolId = 'crypto:BTCUSDT';
    await eventLog.appendSymbolEvent(
      symbolId,
      stateSet({
        ruleId: 'rule-a',
        symbolId,
        ts: 1,
        key: 'cooldown',
        value: { type: StateValueType.Number, value: 5 },
      }),
    );
    await eventLog.appendSymbolEvent(
      symbolId,
      stateSet({
        ruleId: 'rule-a',
        symbolId,
        ts: 2,
        key: 'last_signal',
        value: { type: StateValueType.String, value: 'buy' },
      }),
    );
    const service = new StateHistoryService(eventLog);

    const series = await service.series(symbolId, 'last_signal', {});

    expect(series).toEqual([{ ts: 2, value: { type: StateValueType.String, value: 'buy' } }]);
  });

  it('honors `from` (inclusive) by dropping entries with ts < from', async () => {
    const eventLog = new InMemoryEventLog(() => 1_000);
    const symbolId = 'crypto:BTCUSDT';
    await eventLog.appendSymbolEvent(
      symbolId,
      stateSet({
        ruleId: 'rule-a',
        symbolId,
        ts: 1,
        key: 'count',
        value: { type: StateValueType.Number, value: 1 },
      }),
    );
    await eventLog.appendSymbolEvent(
      symbolId,
      stateSet({
        ruleId: 'rule-a',
        symbolId,
        ts: 5,
        key: 'count',
        value: { type: StateValueType.Number, value: 2 },
      }),
    );
    const service = new StateHistoryService(eventLog);

    const series = await service.series(symbolId, 'count', { from: 5 });

    expect(series).toEqual([{ ts: 5, value: { type: StateValueType.Number, value: 2 } }]);
  });

  it('honors `to` (exclusive) by dropping entries with ts >= to', async () => {
    const eventLog = new InMemoryEventLog(() => 1_000);
    const symbolId = 'crypto:BTCUSDT';
    await eventLog.appendSymbolEvent(
      symbolId,
      stateSet({
        ruleId: 'rule-a',
        symbolId,
        ts: 1,
        key: 'count',
        value: { type: StateValueType.Number, value: 1 },
      }),
    );
    await eventLog.appendSymbolEvent(
      symbolId,
      stateSet({
        ruleId: 'rule-a',
        symbolId,
        ts: 5,
        key: 'count',
        value: { type: StateValueType.Number, value: 2 },
      }),
    );
    const service = new StateHistoryService(eventLog);

    const series = await service.series(symbolId, 'count', { to: 5 });

    expect(series).toEqual([{ ts: 1, value: { type: StateValueType.Number, value: 1 } }]);
  });

  it('returns [] when no StateSet/StateRemoved matches the key', async () => {
    const eventLog = new InMemoryEventLog(() => 1_000);
    const symbolId = 'crypto:BTCUSDT';
    await eventLog.appendSymbolEvent(symbolId, fired({ ruleId: 'rule-a', symbolId, ts: 1 }));
    const service = new StateHistoryService(eventLog);

    const series = await service.series(symbolId, 'never_set', {});

    expect(series).toEqual([]);
  });
});
