import { ActionKind, RuleEventType, StateScope, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { appendStateActionEvent } from './event-appender.js';
import { InMemoryEventLog } from './in-memory-event-log.js';

describe('appendStateActionEvent — SetSymbolState', () => {
  it('appends a StateSet entry to both the rule and the symbol logs', async () => {
    const log = new InMemoryEventLog(() => 999);
    await appendStateActionEvent(
      {
        kind: ActionKind.SetSymbolState,
        key: 'armed',
        value: { type: StateValueType.Bool, value: true },
      },
      'rule-1',
      'AAPL',
      100,
      log,
    );
    const expectedEntry = {
      type: RuleEventType.StateSet,
      ts: 100,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
      scope: StateScope.Symbol,
      key: 'armed',
      value: { type: StateValueType.Bool, value: true },
      firedAt: 999,
    };
    expect(await log.ruleEvents('rule-1')).toEqual([expectedEntry]);
    expect(await log.symbolEvents('AAPL')).toEqual([expectedEntry]);
  });
});

describe('appendStateActionEvent — SetGlobalState', () => {
  it('appends a StateSet entry with the Global scope', async () => {
    const log = new InMemoryEventLog(() => 999);
    await appendStateActionEvent(
      {
        kind: ActionKind.SetGlobalState,
        key: 'regime',
        value: { type: StateValueType.Enum, value: 'risk-on' },
      },
      'rule-1',
      'AAPL',
      100,
      log,
    );
    const expectedEntry = {
      type: RuleEventType.StateSet,
      ts: 100,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
      scope: StateScope.Global,
      key: 'regime',
      value: { type: StateValueType.Enum, value: 'risk-on' },
      firedAt: 999,
    };
    expect(await log.ruleEvents('rule-1')).toEqual([expectedEntry]);
    expect(await log.symbolEvents('AAPL')).toEqual([expectedEntry]);
  });
});

describe('appendStateActionEvent — RemoveSymbolState', () => {
  it('appends a StateRemoved entry with the Symbol scope', async () => {
    const log = new InMemoryEventLog(() => 999);
    await appendStateActionEvent(
      { kind: ActionKind.RemoveSymbolState, key: 'armed' },
      'rule-1',
      'AAPL',
      100,
      log,
    );
    const expectedEntry = {
      type: RuleEventType.StateRemoved,
      ts: 100,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
      scope: StateScope.Symbol,
      key: 'armed',
      firedAt: 999,
    };
    expect(await log.ruleEvents('rule-1')).toEqual([expectedEntry]);
    expect(await log.symbolEvents('AAPL')).toEqual([expectedEntry]);
  });
});

describe('appendStateActionEvent — RemoveGlobalState', () => {
  it('appends a StateRemoved entry with the Global scope', async () => {
    const log = new InMemoryEventLog(() => 999);
    await appendStateActionEvent(
      { kind: ActionKind.RemoveGlobalState, key: 'regime' },
      'rule-1',
      'AAPL',
      100,
      log,
    );
    const expectedEntry = {
      type: RuleEventType.StateRemoved,
      ts: 100,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
      scope: StateScope.Global,
      key: 'regime',
      firedAt: 999,
    };
    expect(await log.ruleEvents('rule-1')).toEqual([expectedEntry]);
    expect(await log.symbolEvents('AAPL')).toEqual([expectedEntry]);
  });
});

describe('InMemoryEventLog', () => {
  it('preserves append order across multiple appends to the same rule', async () => {
    const log = new InMemoryEventLog();
    await log.appendRuleEvent('rule-1', {
      type: RuleEventType.Fired,
      ts: 100,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
    });
    await log.appendRuleEvent('rule-1', {
      type: RuleEventType.Fired,
      ts: 200,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
    });
    expect((await log.ruleEvents('rule-1')).map((event) => event.ts)).toEqual([100, 200]);
  });

  it('isolates events between rules and between symbols', async () => {
    const log = new InMemoryEventLog();
    await log.appendRuleEvent('rule-1', {
      type: RuleEventType.Fired,
      ts: 100,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
    });
    await log.appendSymbolEvent('AAPL', {
      type: RuleEventType.Fired,
      ts: 100,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
    });
    expect(await log.ruleEvents('rule-2')).toEqual([]);
    expect(await log.symbolEvents('MSFT')).toEqual([]);
  });
});
