import {
  type Notifier,
  RulesV2,
  type StateRepository,
  StateScope,
  type StateValue,
  StateValueType,
  UnknownDestinationError,
} from '@lametrader/core';
import { describe, expect, it, vi } from 'vitest';

import type { EvaluationLookups } from '../../rules/evaluation-context.types.js';
import { InMemoryStateRepository } from '../../state/in-memory-state-repository.js';
import { ActionRunner } from './action-runner.js';

/** Build a `Notifier` test double that records every send. */
function recordingNotifier(): {
  notifier: Notifier;
  sent: Array<{ destinationName: string; body: string }>;
} {
  const sent: Array<{ destinationName: string; body: string }> = [];
  const notifier: Notifier = {
    async send(destinationName, body) {
      sent.push({ destinationName, body });
    },
  };
  return { notifier, sent };
}

/** A notifier that throws `UnknownDestinationError` on every send. */
function throwingNotifier(error: Error): Notifier {
  return {
    send: vi.fn(async () => {
      throw error;
    }),
  };
}

/**
 * Build a fully-populated `EvaluationLookups` test double — returns the
 * supplied OHLCV pair for the firing symbol so the `Fired` context snapshot
 * is deterministic.
 */
function lookupsFor(
  symbolId: string,
  ohlcv: Partial<{
    current: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>,
): EvaluationLookups {
  return {
    getCurrentValue: (id) => (id === symbolId ? (ohlcv.current ?? null) : null),
    getOpenValue: (id) => (id === symbolId ? (ohlcv.open ?? null) : null),
    getHighValue: (id) => (id === symbolId ? (ohlcv.high ?? null) : null),
    getLowValue: (id) => (id === symbolId ? (ohlcv.low ?? null) : null),
    getCloseValue: (id) => (id === symbolId ? (ohlcv.close ?? null) : null),
    getVolumeValue: (id) => (id === symbolId ? (ohlcv.volume ?? null) : null),
    getIndicatorValue: () => null,
    getSymbolState: () => null,
    getGlobalState: () => null,
  };
}

const TICK_EVENT: RulesV2.TickEvent = {
  kind: RulesV2.EvaluationTriggerKind.Tick,
  ts: 1_000,
  symbolId: 'AAPL',
  price: 120,
};

/** Build a Rule with an overridable `actions` list (single-symbol AAPL EveryTime). */
function ruleWith(actions: RulesV2.Action[]): RulesV2.Rule {
  return {
    id: 'r1',
    profileId: 'profile-A',
    name: 'Test',
    scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'AAPL' },
    condition: {
      kind: RulesV2.ConditionNodeKind.Leaf,
      leaf: {
        family: RulesV2.LeafConditionFamily.Comparison,
        operator: RulesV2.ComparisonOperator.Gt,
        left: { kind: RulesV2.OperandKind.Price },
        right: {
          kind: RulesV2.OperandKind.Literal,
          value: { type: StateValueType.Number, value: 100 },
        },
      },
    },
    trigger: { kind: RulesV2.TriggerKind.EveryTime },
    expiration: null,
    actions,
    enabled: true,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('ActionRunner', () => {
  it('Notification(channel=telegram) action calls notifier.send with the rendered body and returns [NotificationSent, Fired]', async () => {
    const { notifier, sent } = recordingNotifier();
    const state = new InMemoryStateRepository();
    const lookups = lookupsFor('AAPL', { current: 120 });
    const runner = new ActionRunner(state, notifier, lookups);
    const rule = ruleWith([
      {
        kind: RulesV2.ActionKind.Notification,
        channel: RulesV2.NotificationChannel.Telegram,
        destinationName: 'main',
        template: 'price={current}',
      },
    ]);
    const entries = await runner.run(rule, 'AAPL', 1_000, TICK_EVENT);
    expect(sent).toEqual([{ destinationName: 'main', body: 'price=120' }]);
    expect(entries).toEqual([
      {
        type: RulesV2.RuleEventType.NotificationSent,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'AAPL',
        destinationName: 'main',
        body: 'price=120',
      },
      {
        type: RulesV2.RuleEventType.Fired,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'AAPL',
        context: {
          inboundEvent: TICK_EVENT,
          lookupSnapshot: {
            current: 120,
            open: null,
            high: null,
            low: null,
            close: null,
            volume: null,
          },
        },
      },
    ]);
  });

  it('Notification action with an unknown template token returns [Error, Fired] and does not call the notifier', async () => {
    const { notifier, sent } = recordingNotifier();
    const state = new InMemoryStateRepository();
    const lookups = lookupsFor('AAPL', { current: 120 });
    const runner = new ActionRunner(state, notifier, lookups);
    const rule = ruleWith([
      {
        kind: RulesV2.ActionKind.Notification,
        channel: RulesV2.NotificationChannel.Telegram,
        destinationName: 'main',
        template: 'value={mystery}',
      },
    ]);
    const entries = await runner.run(rule, 'AAPL', 1_000, TICK_EVENT);
    expect(sent).toEqual([]);
    expect(entries).toEqual([
      {
        type: RulesV2.RuleEventType.Error,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'AAPL',
        reason: 'unknown template token: {mystery}',
      },
      {
        type: RulesV2.RuleEventType.Fired,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'AAPL',
        context: {
          inboundEvent: TICK_EVENT,
          lookupSnapshot: {
            current: 120,
            open: null,
            high: null,
            low: null,
            close: null,
            volume: null,
          },
        },
      },
    ]);
  });

  it('Notification action whose notifier throws UnknownDestinationError returns [Error, Fired] carrying the error message as reason', async () => {
    const notifier = throwingNotifier(new UnknownDestinationError('nope'));
    const state = new InMemoryStateRepository();
    const lookups = lookupsFor('AAPL', { current: 120 });
    const runner = new ActionRunner(state, notifier, lookups);
    const rule = ruleWith([
      {
        kind: RulesV2.ActionKind.Notification,
        channel: RulesV2.NotificationChannel.Telegram,
        destinationName: 'nope',
        template: 'hi',
      },
    ]);
    const entries = await runner.run(rule, 'AAPL', 1_000, TICK_EVENT);
    expect(entries).toEqual([
      {
        type: RulesV2.RuleEventType.Error,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'AAPL',
        reason: 'Unknown notifier destination: nope',
      },
      {
        type: RulesV2.RuleEventType.Fired,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'AAPL',
        context: {
          inboundEvent: TICK_EVENT,
          lookupSnapshot: {
            current: 120,
            open: null,
            high: null,
            low: null,
            close: null,
            volume: null,
          },
        },
      },
    ]);
  });

  it('SetSymbolState action writes through state.setSymbolState and returns [StateSet(Symbol), Fired]', async () => {
    const { notifier } = recordingNotifier();
    const state = new InMemoryStateRepository();
    const lookups = lookupsFor('AAPL', { current: 120 });
    const runner = new ActionRunner(state, notifier, lookups);
    const value: StateValue = { type: StateValueType.String, value: 'up' };
    const rule = ruleWith([{ kind: RulesV2.ActionKind.SetSymbolState, key: 'trend', value }]);
    const entries = await runner.run(rule, 'AAPL', 1_000, TICK_EVENT);
    const stored = await state.getSymbolState('profile-A', 'AAPL', 'trend');
    expect(stored).toEqual(value);
    expect(entries).toEqual([
      {
        type: RulesV2.RuleEventType.StateSet,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'AAPL',
        scope: StateScope.Symbol,
        key: 'trend',
        value,
      },
      {
        type: RulesV2.RuleEventType.Fired,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'AAPL',
        context: {
          inboundEvent: TICK_EVENT,
          lookupSnapshot: {
            current: 120,
            open: null,
            high: null,
            low: null,
            close: null,
            volume: null,
          },
        },
      },
    ]);
  });

  it('RemoveSymbolState action calls state.removeSymbolState and returns [StateRemoved(Symbol), Fired]', async () => {
    const { notifier } = recordingNotifier();
    const state: StateRepository = new InMemoryStateRepository();
    await state.setSymbolState(
      'profile-A',
      'AAPL',
      'trend',
      { type: StateValueType.String, value: 'up' },
      0,
    );
    const lookups = lookupsFor('AAPL', { current: 120 });
    const runner = new ActionRunner(state, notifier, lookups);
    const rule = ruleWith([{ kind: RulesV2.ActionKind.RemoveSymbolState, key: 'trend' }]);
    const entries = await runner.run(rule, 'AAPL', 1_000, TICK_EVENT);
    const stored = await state.getSymbolState('profile-A', 'AAPL', 'trend');
    expect(stored).toEqual(null);
    expect(entries).toEqual([
      {
        type: RulesV2.RuleEventType.StateRemoved,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'AAPL',
        scope: StateScope.Symbol,
        key: 'trend',
      },
      {
        type: RulesV2.RuleEventType.Fired,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'AAPL',
        context: {
          inboundEvent: TICK_EVENT,
          lookupSnapshot: {
            current: 120,
            open: null,
            high: null,
            low: null,
            close: null,
            volume: null,
          },
        },
      },
    ]);
  });

  it('SetGlobalState action writes through state.setGlobalState and returns [StateSet(Global), Fired]', async () => {
    const { notifier } = recordingNotifier();
    const state = new InMemoryStateRepository();
    const lookups = lookupsFor('AAPL', { current: 120 });
    const runner = new ActionRunner(state, notifier, lookups);
    const value: StateValue = { type: StateValueType.Bool, value: true };
    const rule = ruleWith([{ kind: RulesV2.ActionKind.SetGlobalState, key: 'armed', value }]);
    const entries = await runner.run(rule, 'AAPL', 1_000, TICK_EVENT);
    const stored = await state.getGlobalState('profile-A', 'armed');
    expect(stored).toEqual(value);
    expect(entries).toEqual([
      {
        type: RulesV2.RuleEventType.StateSet,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'AAPL',
        scope: StateScope.Global,
        key: 'armed',
        value,
      },
      {
        type: RulesV2.RuleEventType.Fired,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'AAPL',
        context: {
          inboundEvent: TICK_EVENT,
          lookupSnapshot: {
            current: 120,
            open: null,
            high: null,
            low: null,
            close: null,
            volume: null,
          },
        },
      },
    ]);
  });

  it('RemoveGlobalState action calls state.removeGlobalState and returns [StateRemoved(Global), Fired]', async () => {
    const { notifier } = recordingNotifier();
    const state: StateRepository = new InMemoryStateRepository();
    await state.setGlobalState('profile-A', 'armed', { type: StateValueType.Bool, value: true }, 0);
    const lookups = lookupsFor('AAPL', { current: 120 });
    const runner = new ActionRunner(state, notifier, lookups);
    const rule = ruleWith([{ kind: RulesV2.ActionKind.RemoveGlobalState, key: 'armed' }]);
    const entries = await runner.run(rule, 'AAPL', 1_000, TICK_EVENT);
    const stored = await state.getGlobalState('profile-A', 'armed');
    expect(stored).toEqual(null);
    expect(entries).toEqual([
      {
        type: RulesV2.RuleEventType.StateRemoved,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'AAPL',
        scope: StateScope.Global,
        key: 'armed',
      },
      {
        type: RulesV2.RuleEventType.Fired,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'AAPL',
        context: {
          inboundEvent: TICK_EVENT,
          lookupSnapshot: {
            current: 120,
            open: null,
            high: null,
            low: null,
            close: null,
            volume: null,
          },
        },
      },
    ]);
  });
});
