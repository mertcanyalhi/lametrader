import {
  ActionKind,
  ComparisonOperator,
  ConditionNodeKind,
  EvaluationTriggerKind,
  LeafConditionFamily,
  NotificationChannel,
  OperandKind,
  Period,
  type Rule,
  RuleEventType,
  RuleScopeKind,
  StateOperator,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryCandleRepository } from '../../candles/in-memory-candle-repository.js';
import { InMemoryNotifier } from '../../notification/in-memory-notifier.js';
import { InMemoryStateRepository } from '../../state/in-memory-state-repository.js';
import { InMemoryWatchlistRepository } from '../../symbols/in-memory-watchlist-repository.js';
import { InMemoryRuleRepository } from '../dispatch/in-memory-rule-repository.js';
import { IndicatorSeriesStore } from '../indicator-series-store.js';
import { InMemoryEventLog } from '../orchestrator/in-memory-event-log.js';
import { cascadePrevLookups, wireRuleEngine } from './wire-rule-engine.js';

describe('cascadePrevLookups', () => {
  const prevValue = { type: StateValueType.String, value: 'off' } as const;

  it('returns event.prev for the matching (profileId, symbolId, key) triple and null for every other slot on a SymbolStateChanged event', () => {
    const lookups = cascadePrevLookups({
      kind: EvaluationTriggerKind.SymbolStateChanged,
      ts: 1_000,
      symbolId: 'AAPL',
      profileId: 'profile-1',
      key: 'phase',
      prev: prevValue,
      current: { type: StateValueType.String, value: 'on' },
    });
    expect({
      matching: lookups.getPrevSymbolState('profile-1', 'AAPL', 'phase'),
      otherProfile: lookups.getPrevSymbolState('profile-2', 'AAPL', 'phase'),
      otherSymbol: lookups.getPrevSymbolState('profile-1', 'MSFT', 'phase'),
      otherKey: lookups.getPrevSymbolState('profile-1', 'AAPL', 'mode'),
      globalIsAlwaysNull: lookups.getPrevGlobalState('profile-1', 'phase'),
    }).toEqual({
      matching: prevValue,
      otherProfile: null,
      otherSymbol: null,
      otherKey: null,
      globalIsAlwaysNull: null,
    });
  });

  it('returns event.prev for the matching (profileId, key) pair and null for every other slot on a GlobalStateChanged event', () => {
    const lookups = cascadePrevLookups({
      kind: EvaluationTriggerKind.GlobalStateChanged,
      ts: 1_000,
      profileId: 'profile-1',
      key: 'regime',
      prev: prevValue,
      current: { type: StateValueType.String, value: 'on' },
    });
    expect({
      matching: lookups.getPrevGlobalState('profile-1', 'regime'),
      otherProfile: lookups.getPrevGlobalState('profile-2', 'regime'),
      otherKey: lookups.getPrevGlobalState('profile-1', 'mode'),
      symbolIsAlwaysNull: lookups.getPrevSymbolState('profile-1', 'AAPL', 'regime'),
    }).toEqual({
      matching: prevValue,
      otherProfile: null,
      otherKey: null,
      symbolIsAlwaysNull: null,
    });
  });

  it('returns null for both lookups on every non-cascade event kind (tick / bar / timer / indicator)', () => {
    const tick = cascadePrevLookups({
      kind: EvaluationTriggerKind.Tick,
      ts: 1_000,
      symbolId: 'AAPL',
      price: 101,
    });
    const barOpened = cascadePrevLookups({
      kind: EvaluationTriggerKind.BarOpened,
      ts: 1_000,
      symbolId: 'AAPL',
      period: Period.M1,
    });
    const barClosed = cascadePrevLookups({
      kind: EvaluationTriggerKind.BarClosed,
      ts: 1_000,
      symbolId: 'AAPL',
      period: Period.M1,
    });
    const timer = cascadePrevLookups({
      kind: EvaluationTriggerKind.Timer,
      ts: 1_000,
    });
    const indicator = cascadePrevLookups({
      kind: EvaluationTriggerKind.IndicatorChanged,
      ts: 1_000,
      symbolId: 'AAPL',
      profileId: 'profile-1',
      instanceId: 'ind-1',
      stateKey: 'phase',
      prev: prevValue,
      current: { type: StateValueType.String, value: 'on' },
    });
    expect({
      tickSymbol: tick.getPrevSymbolState('profile-1', 'AAPL', 'phase'),
      tickGlobal: tick.getPrevGlobalState('profile-1', 'regime'),
      barOpenedSymbol: barOpened.getPrevSymbolState('profile-1', 'AAPL', 'phase'),
      barOpenedGlobal: barOpened.getPrevGlobalState('profile-1', 'regime'),
      barClosedSymbol: barClosed.getPrevSymbolState('profile-1', 'AAPL', 'phase'),
      barClosedGlobal: barClosed.getPrevGlobalState('profile-1', 'regime'),
      timerSymbol: timer.getPrevSymbolState('profile-1', 'AAPL', 'phase'),
      timerGlobal: timer.getPrevGlobalState('profile-1', 'regime'),
      indicatorSymbol: indicator.getPrevSymbolState('profile-1', 'AAPL', 'phase'),
      indicatorGlobal: indicator.getPrevGlobalState('profile-1', 'regime'),
    }).toEqual({
      tickSymbol: null,
      tickGlobal: null,
      barOpenedSymbol: null,
      barOpenedGlobal: null,
      barClosedSymbol: null,
      barClosedGlobal: null,
      timerSymbol: null,
      timerGlobal: null,
      indicatorSymbol: null,
      indicatorGlobal: null,
    });
  });
});

describe('wireRuleEngine cascade ChangesTo / ChangesFrom (regression #433)', () => {
  let rules: InMemoryRuleRepository;
  let eventLog: InMemoryEventLog;
  let state: InMemoryStateRepository;
  let watchlist: InMemoryWatchlistRepository;
  let notifier: InMemoryNotifier;
  let candles: InMemoryCandleRepository;
  let indicatorStore: IndicatorSeriesStore;

  beforeEach(async () => {
    rules = new InMemoryRuleRepository();
    eventLog = new InMemoryEventLog(() => 0);
    state = new InMemoryStateRepository();
    watchlist = new InMemoryWatchlistRepository();
    await watchlist.add({ id: 'AAPL', periods: [Period.M1] });
    notifier = new InMemoryNotifier(['main']);
    candles = new InMemoryCandleRepository();
    indicatorStore = new IndicatorSeriesStore();
  });

  it('fires a rule whose condition is ChangesTo(SymbolStateRef, target) on a cascade SymbolStateChanged event carrying prev=off, current=on', async () => {
    const phaseOn: Rule = {
      id: 'r-changes-to',
      profileId: 'profile-1',
      name: 'changes-to-on',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.State,
          operator: StateOperator.ChangesTo,
          left: {
            kind: OperandKind.SymbolStateRef,
            key: 'phase',
            valueType: StateValueType.String,
          },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.String, value: 'on' },
          },
        },
      },
      trigger: { kind: TriggerKind.EveryTime },
      expiration: null,
      actions: [
        {
          kind: ActionKind.Notification,
          channel: NotificationChannel.Telegram,
          destinationName: 'main',
          template: 'changed to on',
        },
      ],
      enabled: true,
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    };
    await rules.save(phaseOn);

    const wired = await wireRuleEngine({
      rules,
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository: candles,
      indicatorStore,
    });
    // Seed the slot to 'off' AFTER wiring so the sync mirror (subscribed in
    // `wireRuleEngine`) observes the write; the next mutation by the trigger
    // rule then emits a SymbolStateChanged event with prev='off', current='on'
    // — which is what ChangesTo('on') needs to see to admit the fire.
    await state.setSymbolState(
      'profile-1',
      'AAPL',
      'phase',
      { type: StateValueType.String, value: 'off' },
      0,
    );
    // A second rule (order 0, so it fires first) mutates the slot to 'on'
    // when the tick lands; the cascade SymbolStateChanged event it emits is
    // what drives the rule-under-test.
    const trigger: Rule = {
      id: 'r-trigger',
      profileId: 'profile-1',
      name: 'trigger',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.Comparison,
          operator: ComparisonOperator.Gt,
          left: { kind: OperandKind.Price },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.Number, value: 100 },
          },
        },
      },
      trigger: { kind: TriggerKind.EveryTime },
      expiration: null,
      actions: [
        {
          kind: ActionKind.SetSymbolState,
          key: 'phase',
          value: { type: StateValueType.String, value: 'on' },
        },
      ],
      enabled: true,
      order: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    await rules.save(trigger);

    wired.barBridge.handleCandle({
      id: 'AAPL',
      period: Period.OneMinute,
      candle: { time: 60_000, open: 101, high: 101, low: 101, close: 101, volume: 10 },
      final: false,
    });
    await wired.drain();

    const ruleEvents = await eventLog.ruleEvents('r-changes-to');
    expect(ruleEvents.map((e) => e.type)).toEqual([
      RuleEventType.NotificationSent,
      RuleEventType.Fired,
    ]);
    expect(notifier.sent).toEqual([{ destinationName: 'main', body: 'changed to on' }]);
  });

  it('fires a rule whose condition is ChangesFrom(SymbolStateRef, target) on a cascade SymbolStateChanged event carrying prev=on, current=off', async () => {
    const phaseFromOn: Rule = {
      id: 'r-changes-from',
      profileId: 'profile-1',
      name: 'changes-from-on',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.State,
          operator: StateOperator.ChangesFrom,
          left: {
            kind: OperandKind.SymbolStateRef,
            key: 'phase',
            valueType: StateValueType.String,
          },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.String, value: 'on' },
          },
        },
      },
      trigger: { kind: TriggerKind.EveryTime },
      expiration: null,
      actions: [
        {
          kind: ActionKind.Notification,
          channel: NotificationChannel.Telegram,
          destinationName: 'main',
          template: 'changed from on',
        },
      ],
      enabled: true,
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    };
    await rules.save(phaseFromOn);
    // Seed the slot to 'on' BEFORE wiring so the sync mirror is warmed via
    // `warmInitialState`; the cascade then carries prev=on, current=off.
    await state.setSymbolState(
      'profile-1',
      'AAPL',
      'phase',
      { type: StateValueType.String, value: 'on' },
      0,
    );

    const wired = await wireRuleEngine({
      rules,
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository: candles,
      indicatorStore,
    });
    // A second rule mutates the slot to 'off' inside the same tick — that
    // cascade event is what carries prev=on, current=off for the rule under
    // test.
    const trigger: Rule = {
      id: 'r-trigger-off',
      profileId: 'profile-1',
      name: 'trigger-off',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.Comparison,
          operator: ComparisonOperator.Gt,
          left: { kind: OperandKind.Price },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.Number, value: 100 },
          },
        },
      },
      trigger: { kind: TriggerKind.EveryTime },
      expiration: null,
      actions: [
        {
          kind: ActionKind.SetSymbolState,
          key: 'phase',
          value: { type: StateValueType.String, value: 'off' },
        },
      ],
      enabled: true,
      order: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    await rules.save(trigger);

    wired.barBridge.handleCandle({
      id: 'AAPL',
      period: Period.OneMinute,
      candle: { time: 60_000, open: 101, high: 101, low: 101, close: 101, volume: 10 },
      final: false,
    });
    await wired.drain();

    const ruleEvents = await eventLog.ruleEvents('r-changes-from');
    expect(ruleEvents.map((e) => e.type)).toEqual([
      RuleEventType.NotificationSent,
      RuleEventType.Fired,
    ]);
    expect(notifier.sent).toEqual([{ destinationName: 'main', body: 'changed from on' }]);
  });
});
