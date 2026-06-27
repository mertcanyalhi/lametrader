import {
  ActionKind,
  ConditionNodeKind,
  type Notifier,
  NumericOperator,
  OperandKind,
  type Rule,
  RuleEventKind,
  RuleEventType,
  RuleScopeKind,
  StateScope,
  StateValueType,
  TriggerKind,
  UnknownDestinationError,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { InMemoryStateRepository } from '../state/in-memory-state-repository.js';
import { ActionRunner } from './action-runner.js';
import { buildEvaluationContext } from './evaluation-context.js';
import type { EvaluationContext, EvaluationLookups } from './evaluation-context.types.js';
import { InMemoryNotifier } from './in-memory-notifier.js';

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

function priceLookups(): EvaluationLookups {
  return {
    ...emptyLookups(),
    getCurrentValue: (id) => (id === 'AAPL' ? 100 : null),
    getOpenValue: (id) => (id === 'AAPL' ? 99 : null),
    getHighValue: (id) => (id === 'AAPL' ? 101 : null),
    getLowValue: (id) => (id === 'AAPL' ? 98 : null),
    getCloseValue: (id) => (id === 'AAPL' ? 100 : null),
    getVolumeValue: (id) => (id === 'AAPL' ? 1234 : null),
  };
}

function rule(actions: Rule['actions']): Rule {
  return {
    id: 'rule-1',
    profileId: 'profile-1',
    name: 'rule-1',
    scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
    condition: {
      kind: ConditionNodeKind.Leaf,
      left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
      operator: NumericOperator.Gt,
      right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
    },
    trigger: { kind: TriggerKind.Once },
    expiration: null,
    actions,
    enabled: true,
    order: 0,
    events: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

function priceContext(): EvaluationContext {
  return buildEvaluationContext(
    {
      kind: RuleEventKind.CurrentValueChanged,
      ts: 1000,
      symbolId: 'AAPL',
      prev: 99,
      current: 100,
      final: false,
    },
    priceLookups(),
  );
}

describe('ActionRunner.run — SetSymbolState', () => {
  it('writes the value and emits one StateSet entry followed by the Fired umbrella', async () => {
    const state = new InMemoryStateRepository();
    const notifier = new InMemoryNotifier(['main']);
    const runner = new ActionRunner(state, notifier, priceLookups());
    const entries = await runner.run(
      rule([
        {
          kind: ActionKind.SetSymbolState,
          key: 'foo',
          value: { type: StateValueType.Number, value: 1 },
        },
      ]),
      'AAPL',
      1000,
      priceContext(),
    );
    expect(await state.getSymbolState('profile-1', 'AAPL', 'foo')).toEqual({
      type: StateValueType.Number,
      value: 1,
    });
    expect(entries).toEqual([
      {
        type: RuleEventType.StateSet,
        ts: 1000,
        ruleId: 'rule-1',
        symbolId: 'AAPL',
        scope: StateScope.Symbol,
        key: 'foo',
        value: { type: StateValueType.Number, value: 1 },
      },
      {
        type: RuleEventType.Fired,
        ts: 1000,
        ruleId: 'rule-1',
        symbolId: 'AAPL',
        context: {
          inboundEvent: {
            kind: RuleEventKind.CurrentValueChanged,
            ts: 1000,
            symbolId: 'AAPL',
            prev: 99,
            current: 100,
            final: false,
          },
          lookupSnapshot: {
            current: 100,
            open: 99,
            high: 101,
            low: 98,
            close: 100,
            volume: 1234,
          },
        },
      },
    ]);
  });
});

describe('ActionRunner.run — RemoveSymbolState', () => {
  it('removes the key and emits a StateRemoved entry', async () => {
    const state = new InMemoryStateRepository();
    await state.setSymbolState(
      'profile-1',
      'AAPL',
      'foo',
      { type: StateValueType.Number, value: 1 },
      500,
    );
    const runner = new ActionRunner(state, new InMemoryNotifier(['main']), priceLookups());
    const entries = await runner.run(
      rule([{ kind: ActionKind.RemoveSymbolState, key: 'foo' }]),
      'AAPL',
      1000,
      priceContext(),
    );
    expect(await state.getSymbolState('profile-1', 'AAPL', 'foo')).toBeNull();
    expect(entries[0]).toEqual({
      type: RuleEventType.StateRemoved,
      ts: 1000,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
      scope: StateScope.Symbol,
      key: 'foo',
    });
  });
});

describe('ActionRunner.run — SetGlobalState', () => {
  it('writes the value under the rule profile and emits a Global StateSet entry', async () => {
    const state = new InMemoryStateRepository();
    const runner = new ActionRunner(state, new InMemoryNotifier(['main']), priceLookups());
    const entries = await runner.run(
      rule([
        {
          kind: ActionKind.SetGlobalState,
          key: 'regime',
          value: { type: StateValueType.Enum, value: 'risk-on' },
        },
      ]),
      'AAPL',
      1000,
      priceContext(),
    );
    expect(await state.getGlobalState('profile-1', 'regime')).toEqual({
      type: StateValueType.Enum,
      value: 'risk-on',
    });
    expect(entries[0]).toEqual({
      type: RuleEventType.StateSet,
      ts: 1000,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
      scope: StateScope.Global,
      key: 'regime',
      value: { type: StateValueType.Enum, value: 'risk-on' },
    });
  });
});

describe('ActionRunner.run — RemoveGlobalState', () => {
  it('removes the global key and emits a Global StateRemoved entry', async () => {
    const state = new InMemoryStateRepository();
    await state.setGlobalState(
      'profile-1',
      'regime',
      { type: StateValueType.Enum, value: 'risk-on' },
      500,
    );
    const runner = new ActionRunner(state, new InMemoryNotifier(['main']), priceLookups());
    const entries = await runner.run(
      rule([{ kind: ActionKind.RemoveGlobalState, key: 'regime' }]),
      'AAPL',
      1000,
      priceContext(),
    );
    expect(await state.getGlobalState('profile-1', 'regime')).toBeNull();
    expect(entries[0]).toEqual({
      type: RuleEventType.StateRemoved,
      ts: 1000,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
      scope: StateScope.Global,
      key: 'regime',
    });
  });
});

describe('ActionRunner.run — NotifyTelegram happy path', () => {
  it('sends the rendered body and emits a NotificationSent entry', async () => {
    const notifier = new InMemoryNotifier(['main']);
    const runner = new ActionRunner(new InMemoryStateRepository(), notifier, priceLookups());
    const entries = await runner.run(
      rule([
        {
          kind: ActionKind.NotifyTelegram,
          destinationName: 'main',
          template: '{symbolId} crossed {current} (prev {prev}) @ {ts}',
        },
      ]),
      'AAPL',
      1000,
      priceContext(),
    );
    expect(notifier.sent).toEqual([
      { destinationName: 'main', body: 'AAPL crossed 100 (prev 99) @ 1000' },
    ]);
    expect(entries[0]).toEqual({
      type: RuleEventType.NotificationSent,
      ts: 1000,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
      destinationName: 'main',
      body: 'AAPL crossed 100 (prev 99) @ 1000',
    });
  });
});

describe('ActionRunner.run — NotifyTelegram unknown template token', () => {
  it('does not send and emits an Error entry naming the bad token', async () => {
    const notifier = new InMemoryNotifier(['main']);
    const runner = new ActionRunner(new InMemoryStateRepository(), notifier, priceLookups());
    const entries = await runner.run(
      rule([
        {
          kind: ActionKind.NotifyTelegram,
          destinationName: 'main',
          template: 'hello {nope}',
        },
      ]),
      'AAPL',
      1000,
      priceContext(),
    );
    expect(notifier.sent).toEqual([]);
    expect(entries[0]).toEqual({
      type: RuleEventType.Error,
      ts: 1000,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
      reason: 'unknown template token: {nope}',
    });
  });
});

describe('ActionRunner.run — NotifyTelegram unknown destination', () => {
  it('emits an Error entry identifying the missing destination', async () => {
    const notifier = new InMemoryNotifier(['main']);
    const runner = new ActionRunner(new InMemoryStateRepository(), notifier, priceLookups());
    const entries = await runner.run(
      rule([
        {
          kind: ActionKind.NotifyTelegram,
          destinationName: 'missing',
          template: 'hi',
        },
      ]),
      'AAPL',
      1000,
      priceContext(),
    );
    expect(entries[0]).toEqual({
      type: RuleEventType.Error,
      ts: 1000,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
      reason: 'Unknown notifier destination: missing',
    });
  });
});

describe('ActionRunner.run — NotifyTelegram transport failure', () => {
  it('emits an Error entry with the thrown error message', async () => {
    const notifier: Notifier = {
      async send() {
        throw new Error('telegram api down');
      },
    };
    const runner = new ActionRunner(new InMemoryStateRepository(), notifier, priceLookups());
    const entries = await runner.run(
      rule([
        {
          kind: ActionKind.NotifyTelegram,
          destinationName: 'main',
          template: 'hi',
        },
      ]),
      'AAPL',
      1000,
      priceContext(),
    );
    expect(entries[0]).toEqual({
      type: RuleEventType.Error,
      ts: 1000,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
      reason: 'telegram api down',
    });
  });

  it('rethrows non-Error throws as a String-coerced reason', async () => {
    const notifier: Notifier = {
      async send() {
        throw 'boom';
      },
    };
    const runner = new ActionRunner(new InMemoryStateRepository(), notifier, priceLookups());
    const entries = await runner.run(
      rule([
        {
          kind: ActionKind.NotifyTelegram,
          destinationName: 'main',
          template: 'hi',
        },
      ]),
      'AAPL',
      1000,
      priceContext(),
    );
    expect(entries[0]).toEqual({
      type: RuleEventType.Error,
      ts: 1000,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
      reason: 'boom',
    });
  });

  it('surfaces UnknownDestinationError.message even when caught from the notifier', async () => {
    const notifier: Notifier = {
      async send() {
        throw new UnknownDestinationError('ghost');
      },
    };
    const runner = new ActionRunner(new InMemoryStateRepository(), notifier, priceLookups());
    const entries = await runner.run(
      rule([
        {
          kind: ActionKind.NotifyTelegram,
          destinationName: 'ghost',
          template: 'hi',
        },
      ]),
      'AAPL',
      1000,
      priceContext(),
    );
    expect(entries[0]).toEqual({
      type: RuleEventType.Error,
      ts: 1000,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
      reason: 'Unknown notifier destination: ghost',
    });
  });
});

describe('ActionRunner.run — multi-action fire', () => {
  it('emits per-action entries in action order followed by exactly one Fired entry', async () => {
    const notifier = new InMemoryNotifier(['main']);
    const runner = new ActionRunner(new InMemoryStateRepository(), notifier, priceLookups());
    const entries = await runner.run(
      rule([
        {
          kind: ActionKind.SetSymbolState,
          key: 'flag',
          value: { type: StateValueType.Bool, value: true },
        },
        { kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'hi' },
      ]),
      'AAPL',
      1000,
      priceContext(),
    );
    expect(entries.map((entry) => entry.type)).toEqual([
      RuleEventType.StateSet,
      RuleEventType.NotificationSent,
      RuleEventType.Fired,
    ]);
  });
});

describe('ActionRunner.run — captureContext', () => {
  it("snapshots the lookups' OHLCV values into the Fired entry's context payload", async () => {
    const runner = new ActionRunner(
      new InMemoryStateRepository(),
      new InMemoryNotifier(['main']),
      priceLookups(),
    );
    const entries = await runner.run(
      rule([{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'hi' }]),
      'AAPL',
      1000,
      priceContext(),
    );
    const fired = entries[entries.length - 1];
    expect(fired).toEqual({
      type: RuleEventType.Fired,
      ts: 1000,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
      context: {
        inboundEvent: {
          kind: RuleEventKind.CurrentValueChanged,
          ts: 1000,
          symbolId: 'AAPL',
          prev: 99,
          current: 100,
          final: false,
        },
        lookupSnapshot: {
          current: 100,
          open: 99,
          high: 101,
          low: 98,
          close: 100,
          volume: 1234,
        },
      },
    });
  });

  it('produces a null-filled lookup snapshot when the lookups return null', async () => {
    const runner = new ActionRunner(
      new InMemoryStateRepository(),
      new InMemoryNotifier(['main']),
      emptyLookups(),
    );
    const entries = await runner.run(
      rule([{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'hi' }]),
      'AAPL',
      1000,
      priceContext(),
    );
    const fired = entries[entries.length - 1];
    expect(fired).toEqual({
      type: RuleEventType.Fired,
      ts: 1000,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
      context: {
        inboundEvent: {
          kind: RuleEventKind.CurrentValueChanged,
          ts: 1000,
          symbolId: 'AAPL',
          prev: 99,
          current: 100,
          final: false,
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
    });
  });
});
