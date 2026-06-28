import {
  type Notifier,
  Period,
  RulesV2,
  StateScope,
  StateValueType,
  UnknownDestinationError,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { InMemoryStateRepository } from '../../state/in-memory-state-repository.js';
import { buildEvaluationContext } from '../evaluation-context.js';
import type { EvaluationLookups } from '../evaluation-context.types.js';
import { ActionRunner, type RunActionsInput } from './action-runner.js';

const fakeLookups = (partial: Partial<EvaluationLookups> = {}): EvaluationLookups => ({
  latestPrice: () => null,
  latestOhlcv: () => null,
  latestIndicator: () => null,
  latestSymbolState: () => null,
  latestGlobalState: () => null,
  prevIndicator: () => null,
  prevSymbolState: () => null,
  prevGlobalState: () => null,
  priceSeries: () => null,
  barSeries: () => null,
  indicatorSeries: () => null,
  ...partial,
});

class RecordingNotifier implements Notifier {
  readonly sends: Array<{ destinationName: string; body: string }> = [];
  constructor(
    private readonly behaviour: (destinationName: string, body: string) => void = () => undefined,
  ) {}
  async send(destinationName: string, body: string): Promise<void> {
    this.sends.push({ destinationName, body });
    this.behaviour(destinationName, body);
  }
}

const tickAt = (ts: number, price: number): RulesV2.EvaluationTriggerEvent => ({
  kind: RulesV2.EvaluationTriggerKind.Tick,
  ts,
  symbolId: 'BTC',
  price,
});

const ruleWithActions = (actions: RulesV2.Action[]): RulesV2.Rule => ({
  id: 'r1',
  profileId: 'p1',
  name: 'rule',
  scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' },
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
});

const buildInput = (overrides: {
  actions: RulesV2.Action[];
  lookups?: EvaluationLookups;
  ts?: number;
  event?: RulesV2.EvaluationTriggerEvent;
}): {
  input: RunActionsInput;
  state: InMemoryStateRepository;
  notifier: RecordingNotifier;
  lookups: EvaluationLookups;
} => {
  const lookups = overrides.lookups ?? fakeLookups();
  const ts = overrides.ts ?? 1_000;
  const event = overrides.event ?? tickAt(ts, 120);
  const state = new InMemoryStateRepository();
  const notifier = new RecordingNotifier();
  const rule = ruleWithActions(overrides.actions);
  const context = buildEvaluationContext({
    event,
    profileId: rule.profileId,
    symbolId: 'BTC',
    lookups,
    defaultPeriod: Period.OneMinute,
  });
  const input: RunActionsInput = {
    rule,
    firingSymbolId: 'BTC',
    ts,
    context,
    snapshotPeriod: Period.OneMinute,
  };
  return { input, state, notifier, lookups };
};

describe('ActionRunner', () => {
  it('runs a Notification action: calls the notifier with the rendered body, then returns [NotificationSent, Fired(context.inboundEvent + lookupSnapshot)]', async () => {
    const lookups = fakeLookups({
      latestPrice: () => 120,
      latestOhlcv: (_s, _p, axis) =>
        ({ open: 100, high: 130, low: 95, close: 120, volume: 1_000 })[axis as string] ?? null,
    });
    const { input, notifier } = buildInput({
      actions: [
        {
          kind: RulesV2.ActionKind.Notification,
          channel: RulesV2.NotificationChannel.Telegram,
          destinationName: 'desk',
          template: 'Fired {symbolId} at {ts}',
        },
      ],
      lookups,
    });
    const runner = new ActionRunner(new InMemoryStateRepository(), notifier, lookups);
    const entries = await runner.run(input);
    expect({
      sends: notifier.sends,
      entries,
    }).toEqual({
      sends: [{ destinationName: 'desk', body: 'Fired BTC at 1000' }],
      entries: [
        {
          type: RulesV2.RuleEventType.NotificationSent,
          ts: 1_000,
          ruleId: 'r1',
          symbolId: 'BTC',
          destinationName: 'desk',
          body: 'Fired BTC at 1000',
        },
        {
          type: RulesV2.RuleEventType.Fired,
          ts: 1_000,
          ruleId: 'r1',
          symbolId: 'BTC',
          context: {
            inboundEvent: tickAt(1_000, 120),
            lookupSnapshot: {
              current: 120,
              open: 100,
              high: 130,
              low: 95,
              close: 120,
              volume: 1_000,
            },
          },
        },
      ],
    });
  });

  it('runs a SetSymbolState action: writes through state.setSymbolState(profileId, symbolId, key, value, ts) and returns [StateSet(scope=Symbol), Fired]', async () => {
    const state = new InMemoryStateRepository();
    const lookups = fakeLookups();
    const { input } = buildInput({
      actions: [
        {
          kind: RulesV2.ActionKind.SetSymbolState,
          key: 'armed',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
      lookups,
    });
    const runner = new ActionRunner(state, new RecordingNotifier(), lookups);
    const entries = await runner.run(input);
    expect({
      stored: await state.getSymbolState('p1', 'BTC', 'armed'),
      entries: entries.map((e) => e.type),
      stateSet: entries[0],
    }).toEqual({
      stored: { type: StateValueType.Bool, value: true },
      entries: [RulesV2.RuleEventType.StateSet, RulesV2.RuleEventType.Fired],
      stateSet: {
        type: RulesV2.RuleEventType.StateSet,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'BTC',
        scope: StateScope.Symbol,
        key: 'armed',
        value: { type: StateValueType.Bool, value: true },
      },
    });
  });

  it('runs a RemoveSymbolState action: removes via state.removeSymbolState and returns [StateRemoved(scope=Symbol), Fired]', async () => {
    const state = new InMemoryStateRepository();
    await state.setSymbolState('p1', 'BTC', 'armed', { type: StateValueType.Bool, value: true }, 0);
    const lookups = fakeLookups();
    const { input } = buildInput({
      actions: [{ kind: RulesV2.ActionKind.RemoveSymbolState, key: 'armed' }],
      lookups,
    });
    const runner = new ActionRunner(state, new RecordingNotifier(), lookups);
    const entries = await runner.run(input);
    expect({
      stored: await state.getSymbolState('p1', 'BTC', 'armed'),
      stateRemoved: entries[0],
    }).toEqual({
      stored: null,
      stateRemoved: {
        type: RulesV2.RuleEventType.StateRemoved,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'BTC',
        scope: StateScope.Symbol,
        key: 'armed',
      },
    });
  });

  it('runs a SetGlobalState action: writes through state.setGlobalState(profileId, key, value, ts) and returns [StateSet(scope=Global), Fired]', async () => {
    const state = new InMemoryStateRepository();
    const lookups = fakeLookups();
    const { input } = buildInput({
      actions: [
        {
          kind: RulesV2.ActionKind.SetGlobalState,
          key: 'last-signal',
          value: { type: StateValueType.Enum, value: 'long' },
        },
      ],
      lookups,
    });
    const runner = new ActionRunner(state, new RecordingNotifier(), lookups);
    const entries = await runner.run(input);
    expect({
      stored: await state.getGlobalState('p1', 'last-signal'),
      stateSet: entries[0],
    }).toEqual({
      stored: { type: StateValueType.Enum, value: 'long' },
      stateSet: {
        type: RulesV2.RuleEventType.StateSet,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'BTC',
        scope: StateScope.Global,
        key: 'last-signal',
        value: { type: StateValueType.Enum, value: 'long' },
      },
    });
  });

  it('runs a RemoveGlobalState action: removes via state.removeGlobalState and returns [StateRemoved(scope=Global), Fired]', async () => {
    const state = new InMemoryStateRepository();
    await state.setGlobalState('p1', 'k', { type: StateValueType.Number, value: 1 }, 0);
    const lookups = fakeLookups();
    const { input } = buildInput({
      actions: [{ kind: RulesV2.ActionKind.RemoveGlobalState, key: 'k' }],
      lookups,
    });
    const runner = new ActionRunner(state, new RecordingNotifier(), lookups);
    const entries = await runner.run(input);
    expect({
      stored: await state.getGlobalState('p1', 'k'),
      stateRemoved: entries[0],
    }).toEqual({
      stored: null,
      stateRemoved: {
        type: RulesV2.RuleEventType.StateRemoved,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'BTC',
        scope: StateScope.Global,
        key: 'k',
      },
    });
  });

  it('emits an Error entry (not NotificationSent) when the notifier throws UnknownDestinationError', async () => {
    const lookups = fakeLookups();
    const { input } = buildInput({
      actions: [
        {
          kind: RulesV2.ActionKind.Notification,
          channel: RulesV2.NotificationChannel.Telegram,
          destinationName: 'unknown',
          template: 'hi',
        },
      ],
      lookups,
    });
    const notifier = new RecordingNotifier(() => {
      throw new UnknownDestinationError('unknown');
    });
    const runner = new ActionRunner(new InMemoryStateRepository(), notifier, lookups);
    const entries = await runner.run(input);
    expect(entries[0]).toEqual({
      type: RulesV2.RuleEventType.Error,
      ts: 1_000,
      ruleId: 'r1',
      symbolId: 'BTC',
      reason: 'Unknown notifier destination: unknown',
    });
  });

  it('emits an Error entry without calling the notifier when the template references an unknown token', async () => {
    const lookups = fakeLookups();
    const { input } = buildInput({
      actions: [
        {
          kind: RulesV2.ActionKind.Notification,
          channel: RulesV2.NotificationChannel.Telegram,
          destinationName: 'desk',
          template: 'hi {unknown}',
        },
      ],
      lookups,
    });
    const notifier = new RecordingNotifier();
    const runner = new ActionRunner(new InMemoryStateRepository(), notifier, lookups);
    const entries = await runner.run(input);
    expect({
      sends: notifier.sends,
      error: entries[0],
    }).toEqual({
      sends: [],
      error: {
        type: RulesV2.RuleEventType.Error,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'BTC',
        reason: 'unknown template token: {unknown}',
      },
    });
  });
});
