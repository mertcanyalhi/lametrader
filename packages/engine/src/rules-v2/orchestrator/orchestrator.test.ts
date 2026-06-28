import {
  type Notifier,
  Period,
  RulesV2,
  StateScope,
  StateValueType,
  SymbolType,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { InMemoryStateRepository } from '../../state/in-memory-state-repository.js';
import { InMemoryWatchlistRepository } from '../../symbols/in-memory-watchlist-repository.js';
import { TriggerDispatcher } from '../dispatch/dispatcher.js';
import type { EvaluationLookups } from '../evaluation-context.types.js';
import { ActionRunner } from './action-runner.js';
import { InMemoryEventLog } from './in-memory-event-log.js';
import { InMemoryRuleRepository } from './in-memory-rule-repository.js';
import { RuleOrchestrator } from './orchestrator.js';

class RecordingNotifier implements Notifier {
  readonly sends: Array<{ destinationName: string; body: string }> = [];
  async send(destinationName: string, body: string): Promise<void> {
    this.sends.push({ destinationName, body });
  }
}

/**
 * Build a fake {@link EvaluationLookups} backed by a per-symbol map of
 * latest tick prices and a per-(profile, symbol, key) map of latest
 * symbol-state values. Other lookup methods return `null`.
 */
const buildLookups = (config: {
  priceBySymbol?: Record<string, number>;
  symbolStateByKey?: (profileId: string, symbolId: string, key: string) => unknown;
}): EvaluationLookups => ({
  latestPrice: (symbolId) => config.priceBySymbol?.[symbolId] ?? null,
  latestOhlcv: () => null,
  latestIndicator: () => null,
  latestSymbolState: (profileId, symbolId, key) => {
    const raw = config.symbolStateByKey?.(profileId, symbolId, key);
    if (raw === undefined || raw === null) return null;
    if (typeof raw === 'boolean') return { type: StateValueType.Bool, value: raw };
    if (typeof raw === 'number') return { type: StateValueType.Number, value: raw };
    if (typeof raw === 'string') return { type: StateValueType.Enum, value: raw };
    return null;
  },
  latestGlobalState: () => null,
  prevIndicator: () => null,
  prevSymbolState: () => null,
  prevGlobalState: () => null,
  priceSeries: () => null,
  barSeries: () => null,
  indicatorSeries: () => null,
});

const priceGt100Condition: RulesV2.ConditionNode = {
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
};

const buildRule = (overrides: Partial<RulesV2.Rule> = {}): RulesV2.Rule => ({
  id: 'r1',
  profileId: 'p1',
  name: 'rule',
  scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' },
  condition: priceGt100Condition,
  trigger: { kind: RulesV2.TriggerKind.EveryTime },
  expiration: null,
  actions: [],
  enabled: true,
  order: 0,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

const tickAt = (ts: number, symbolId: string, price: number): RulesV2.EvaluationTriggerEvent => ({
  kind: RulesV2.EvaluationTriggerKind.Tick,
  ts,
  symbolId,
  price,
});

const globalStateChangedAt = (
  ts: number,
  profileId: string,
  key: string,
  current: { type: StateValueType; value: unknown },
): RulesV2.EvaluationTriggerEvent => ({
  kind: RulesV2.EvaluationTriggerKind.GlobalStateChanged,
  ts,
  profileId,
  key,
  prev: null,
  current: current as RulesV2.GlobalStateChangedEvent['current'],
});

const barOpenedAt = (
  ts: number,
  symbolId: string,
  period: Period,
): RulesV2.EvaluationTriggerEvent => ({
  kind: RulesV2.EvaluationTriggerKind.BarOpened,
  ts,
  symbolId,
  period,
});

const notifyAction = (destinationName: string, template: string): RulesV2.Action => ({
  kind: RulesV2.ActionKind.Notification,
  channel: RulesV2.NotificationChannel.Telegram,
  destinationName,
  template,
});

const watchedSymbol = (id: string) => ({
  id,
  type: SymbolType.Crypto,
  description: id,
  exchange: 'test',
  periods: [Period.OneMinute],
});

const buildOrchestrator = (deps: {
  rules: InMemoryRuleRepository;
  lookups: EvaluationLookups;
  state?: InMemoryStateRepository;
  notifier?: Notifier;
  watchlist?: InMemoryWatchlistRepository;
  cycleLimit?: number;
}) => {
  const state = deps.state ?? new InMemoryStateRepository();
  const notifier = deps.notifier ?? new RecordingNotifier();
  const watchlist = deps.watchlist ?? new InMemoryWatchlistRepository([watchedSymbol('BTC')]);
  const eventLog = new InMemoryEventLog(() => 0);
  const dispatcher = new TriggerDispatcher();
  const actionRunner = new ActionRunner(state, notifier, deps.lookups);
  const orchestrator = new RuleOrchestrator(
    deps.rules,
    watchlist,
    deps.lookups,
    state,
    eventLog,
    dispatcher,
    actionRunner,
    deps.cycleLimit !== undefined ? { cycleLimit: deps.cycleLimit } : undefined,
  );
  return { orchestrator, eventLog, dispatcher, state, watchlist };
};

describe('RuleOrchestrator', () => {
  it('appends a NotificationSent entry and a Fired entry to both the rule log and the symbol log when an EveryTime Price>100 rule with a Notification action receives a Tick(price=120)', async () => {
    const rule = buildRule({
      actions: [notifyAction('desk', 'fired {symbolId}')],
    });
    const repo = new InMemoryRuleRepository([rule]);
    const lookups = buildLookups({ priceBySymbol: { BTC: 120 } });
    const notifier = new RecordingNotifier();
    const { orchestrator, eventLog } = buildOrchestrator({ rules: repo, lookups, notifier });

    await orchestrator.process(tickAt(1_000, 'BTC', 120));

    const ruleEvents = await eventLog.ruleEvents('r1');
    const symbolEvents = await eventLog.symbolEvents('BTC');
    expect({
      ruleEventTypes: ruleEvents.map((e) => e.type),
      symbolEventTypes: symbolEvents.map((e) => e.type),
      notifierSends: notifier.sends,
    }).toEqual({
      ruleEventTypes: [RulesV2.RuleEventType.NotificationSent, RulesV2.RuleEventType.Fired],
      symbolEventTypes: [RulesV2.RuleEventType.NotificationSent, RulesV2.RuleEventType.Fired],
      notifierSends: [{ destinationName: 'desk', body: 'fired BTC' }],
    });
  });

  it('does NOT fire when the condition evaluates to false (Price<=100 for a Gt condition)', async () => {
    const rule = buildRule({ actions: [notifyAction('desk', 'fired')] });
    const repo = new InMemoryRuleRepository([rule]);
    const lookups = buildLookups({ priceBySymbol: { BTC: 90 } });
    const { orchestrator, eventLog } = buildOrchestrator({ rules: repo, lookups });

    await orchestrator.process(tickAt(1_000, 'BTC', 90));

    expect(await eventLog.symbolEvents('BTC')).toEqual([]);
  });

  it('auto-disables a Once-triggered rule after its first fire by saving the rule back with enabled=false', async () => {
    const rule = buildRule({
      trigger: { kind: RulesV2.TriggerKind.Once },
      actions: [notifyAction('desk', 'one')],
    });
    const repo = new InMemoryRuleRepository([rule]);
    const lookups = buildLookups({ priceBySymbol: { BTC: 120 } });
    const { orchestrator } = buildOrchestrator({ rules: repo, lookups });

    await orchestrator.process(tickAt(1_000, 'BTC', 120));

    expect(await repo.get('r1')).toEqual({ ...rule, enabled: false });
  });

  it('fires a OncePerBar rule at most once across a tick burst in the same bar, then re-arms on the next BarOpened so a subsequent tick fires again', async () => {
    const rule = buildRule({
      trigger: { kind: RulesV2.TriggerKind.OncePerBar, period: Period.OneMinute },
      actions: [notifyAction('desk', 'tick {ts}')],
    });
    const repo = new InMemoryRuleRepository([rule]);
    const lookups = buildLookups({ priceBySymbol: { BTC: 120 } });
    const notifier = new RecordingNotifier();
    const { orchestrator } = buildOrchestrator({ rules: repo, lookups, notifier });

    await orchestrator.process(tickAt(1_000, 'BTC', 120));
    await orchestrator.process(tickAt(2_000, 'BTC', 121));
    await orchestrator.process(tickAt(3_000, 'BTC', 122));
    await orchestrator.process(barOpenedAt(60_000, 'BTC', Period.OneMinute));
    await orchestrator.process(tickAt(60_500, 'BTC', 123));

    expect(notifier.sends.map((s) => s.body)).toEqual(['tick 1000', 'tick 60500']);
  });

  it('cascades a state-mutation action into a downstream same-profile rule whose condition reads that state, within the same tick', async () => {
    const stateValues = new Map<string, boolean>();
    const stateKey = (profileId: string, symbolId: string, key: string) =>
      `${profileId}|${symbolId}|${key}`;
    const lookups = buildLookups({
      priceBySymbol: { BTC: 120 },
      symbolStateByKey: (profileId, symbolId, key) =>
        stateValues.get(stateKey(profileId, symbolId, key)),
    });

    const upstream = buildRule({
      id: 'upstream',
      order: 1,
      actions: [
        {
          kind: RulesV2.ActionKind.SetSymbolState,
          key: 'armed',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
    });
    const downstream = buildRule({
      id: 'downstream',
      order: 2,
      // Bar-cadence trigger so the inbound Tick doesn't route to this rule —
      // only the SymbolStateChanged cascade event (which routes by operand
      // reference, ignoring trigger kind) can fire it.
      trigger: { kind: RulesV2.TriggerKind.OncePerBarOpen, period: Period.OneMinute },
      condition: {
        kind: RulesV2.ConditionNodeKind.Leaf,
        leaf: {
          family: RulesV2.LeafConditionFamily.State,
          operator: RulesV2.StateOperator.Equals,
          left: {
            kind: RulesV2.OperandKind.SymbolStateRef,
            key: 'armed',
            valueType: StateValueType.Bool,
          },
          right: {
            kind: RulesV2.OperandKind.Literal,
            value: { type: StateValueType.Bool, value: true },
          },
        },
      },
      actions: [notifyAction('desk', 'armed cascade {symbolId}')],
    });

    const repo = new InMemoryRuleRepository([upstream, downstream]);
    const state = new InMemoryStateRepository();
    const notifier = new RecordingNotifier();
    state.onStateChanged((event) => {
      if (event.scope.kind === StateScope.Symbol) {
        stateValues.set(
          stateKey(event.profileId, event.scope.symbolId, event.key),
          event.current?.value === true,
        );
      }
    });
    const { orchestrator } = buildOrchestrator({ rules: repo, lookups, notifier, state });

    await orchestrator.process(tickAt(1_000, 'BTC', 120));

    expect(notifier.sends).toEqual([{ destinationName: 'desk', body: 'armed cascade BTC' }]);
  });

  it('fans an event out to every matching profile (multi-profile fan-out): a Tick that matches one rule on profile A and one rule on profile B fires both', async () => {
    const aRule = buildRule({
      id: 'a',
      profileId: 'pA',
      actions: [notifyAction('desk', 'a fired')],
    });
    const bRule = buildRule({
      id: 'b',
      profileId: 'pB',
      actions: [notifyAction('desk', 'b fired')],
    });
    const repo = new InMemoryRuleRepository([aRule, bRule]);
    const lookups = buildLookups({ priceBySymbol: { BTC: 120 } });
    const notifier = new RecordingNotifier();
    const { orchestrator } = buildOrchestrator({ rules: repo, lookups, notifier });

    await orchestrator.process(tickAt(1_000, 'BTC', 120));

    expect(notifier.sends.map((s) => s.body).sort()).toEqual(['a fired', 'b fired']);
  });

  it('fans an AllSymbols-scoped rule out across every watched symbol when the inbound event carries no symbolId (GlobalStateChanged)', async () => {
    const globalSignalEqualsOn: RulesV2.ConditionNode = {
      kind: RulesV2.ConditionNodeKind.Leaf,
      leaf: {
        family: RulesV2.LeafConditionFamily.State,
        operator: RulesV2.StateOperator.Equals,
        left: {
          kind: RulesV2.OperandKind.GlobalStateRef,
          key: 'signal',
          valueType: StateValueType.Enum,
        },
        right: {
          kind: RulesV2.OperandKind.Literal,
          value: { type: StateValueType.Enum, value: 'on' },
        },
      },
    };
    const rule = buildRule({
      id: 'all',
      scope: { kind: RulesV2.RuleScopeKind.AllSymbols },
      trigger: { kind: RulesV2.TriggerKind.EveryTime },
      condition: globalSignalEqualsOn,
      actions: [notifyAction('desk', 'fired {symbolId}')],
    });
    const repo = new InMemoryRuleRepository([rule]);
    const lookups = buildLookups({
      symbolStateByKey: () => null,
    });
    // The condition reads from a separate global-state slot; build a lookups
    // variant that returns 'on' from latestGlobalState for the matching key.
    const lookupsWithGlobal: EvaluationLookups = {
      ...lookups,
      latestGlobalState: (_profileId, key) =>
        key === 'signal' ? { type: StateValueType.Enum, value: 'on' } : null,
    };
    const notifier = new RecordingNotifier();
    const watchlist = new InMemoryWatchlistRepository([watchedSymbol('BTC'), watchedSymbol('ETH')]);
    const { orchestrator } = buildOrchestrator({
      rules: repo,
      lookups: lookupsWithGlobal,
      notifier,
      watchlist,
    });

    await orchestrator.process(
      globalStateChangedAt(1_000, 'p1', 'signal', { type: StateValueType.Enum, value: 'on' }),
    );

    expect(notifier.sends.map((s) => s.body).sort()).toEqual(['fired BTC', 'fired ETH']);
  });

  it('fans a Symbols-scoped rule out across every symbol in scope.symbolIds when the inbound event carries no symbolId (GlobalStateChanged)', async () => {
    const globalSignalEqualsOn: RulesV2.ConditionNode = {
      kind: RulesV2.ConditionNodeKind.Leaf,
      leaf: {
        family: RulesV2.LeafConditionFamily.State,
        operator: RulesV2.StateOperator.Equals,
        left: {
          kind: RulesV2.OperandKind.GlobalStateRef,
          key: 'signal',
          valueType: StateValueType.Enum,
        },
        right: {
          kind: RulesV2.OperandKind.Literal,
          value: { type: StateValueType.Enum, value: 'on' },
        },
      },
    };
    const rule = buildRule({
      id: 'list',
      scope: { kind: RulesV2.RuleScopeKind.Symbols, symbolIds: ['BTC', 'ETH'] },
      trigger: { kind: RulesV2.TriggerKind.EveryTime },
      condition: globalSignalEqualsOn,
      actions: [notifyAction('desk', 'fired {symbolId}')],
    });
    const repo = new InMemoryRuleRepository([rule]);
    const baseLookups = buildLookups({});
    const lookupsWithGlobal: EvaluationLookups = {
      ...baseLookups,
      latestGlobalState: (_profileId, key) =>
        key === 'signal' ? { type: StateValueType.Enum, value: 'on' } : null,
    };
    const notifier = new RecordingNotifier();
    const watchlist = new InMemoryWatchlistRepository([
      watchedSymbol('BTC'),
      watchedSymbol('ETH'),
      watchedSymbol('SOL'),
    ]);
    const { orchestrator } = buildOrchestrator({
      rules: repo,
      lookups: lookupsWithGlobal,
      notifier,
      watchlist,
    });

    await orchestrator.process(
      globalStateChangedAt(1_000, 'p1', 'signal', { type: StateValueType.Enum, value: 'on' }),
    );

    expect(notifier.sends.map((s) => s.body).sort()).toEqual(['fired BTC', 'fired ETH']);
  });

  it('records exactly one CycleOverflow rule-event on the affected symbol log and halts further cascade when a flip-flop pair of state-mutation rules exceeds the cycle limit', async () => {
    const stateValues = new Map<string, boolean>();
    const stateKey = (profileId: string, symbolId: string, key: string) =>
      `${profileId}|${symbolId}|${key}`;
    stateValues.set('p1|BTC|x', true);
    const lookups = buildLookups({
      priceBySymbol: { BTC: 120 },
      symbolStateByKey: (profileId, symbolId, key) =>
        stateValues.get(stateKey(profileId, symbolId, key)),
    });

    const xRefTrue: RulesV2.ConditionNode = {
      kind: RulesV2.ConditionNodeKind.Leaf,
      leaf: {
        family: RulesV2.LeafConditionFamily.State,
        operator: RulesV2.StateOperator.Equals,
        left: {
          kind: RulesV2.OperandKind.SymbolStateRef,
          key: 'x',
          valueType: StateValueType.Bool,
        },
        right: {
          kind: RulesV2.OperandKind.Literal,
          value: { type: StateValueType.Bool, value: true },
        },
      },
    };
    const xRefFalse: RulesV2.ConditionNode = {
      kind: RulesV2.ConditionNodeKind.Leaf,
      leaf: {
        family: RulesV2.LeafConditionFamily.State,
        operator: RulesV2.StateOperator.Equals,
        left: {
          kind: RulesV2.OperandKind.SymbolStateRef,
          key: 'x',
          valueType: StateValueType.Bool,
        },
        right: {
          kind: RulesV2.OperandKind.Literal,
          value: { type: StateValueType.Bool, value: false },
        },
      },
    };
    const setXFalse = buildRule({
      id: 'set-false',
      order: 1,
      condition: xRefTrue,
      actions: [
        {
          kind: RulesV2.ActionKind.SetSymbolState,
          key: 'x',
          value: { type: StateValueType.Bool, value: false },
        },
      ],
    });
    const setXTrue = buildRule({
      id: 'set-true',
      order: 2,
      condition: xRefFalse,
      actions: [
        {
          kind: RulesV2.ActionKind.SetSymbolState,
          key: 'x',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
    });

    const repo = new InMemoryRuleRepository([setXFalse, setXTrue]);
    const state = new InMemoryStateRepository();
    await state.setSymbolState('p1', 'BTC', 'x', { type: StateValueType.Bool, value: true }, 0);
    state.onStateChanged((event) => {
      if (event.scope.kind === StateScope.Symbol) {
        stateValues.set(
          stateKey(event.profileId, event.scope.symbolId, event.key),
          event.current?.value === true,
        );
      }
    });
    const { orchestrator, eventLog } = buildOrchestrator({
      rules: repo,
      lookups,
      state,
      cycleLimit: 2,
    });

    await orchestrator.process(tickAt(1_000, 'BTC', 120));

    const symbolEvents = await eventLog.symbolEvents('BTC');
    const overflows = symbolEvents.filter((e) => e.type === RulesV2.RuleEventType.CycleOverflow);
    expect(overflows.length).toEqual(1);
  });
});
