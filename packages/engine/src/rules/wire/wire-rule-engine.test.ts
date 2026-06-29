import {
  ActionKind,
  ComparisonOperator,
  ConditionNodeKind,
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
import { _resetLogRoot, _setLogLevel } from '../../log.js';
import { InMemoryNotifier } from '../../notification/in-memory-notifier.js';
import { InMemoryStateRepository } from '../../state/in-memory-state-repository.js';
import { InMemoryWatchlistRepository } from '../../symbols/in-memory-watchlist-repository.js';
import { InMemoryRuleRepository } from '../dispatch/in-memory-rule-repository.js';
import { IndicatorSeriesStore } from '../indicator-series-store.js';
import { InMemoryEventLog } from '../orchestrator/in-memory-event-log.js';
import { wireRuleEngine } from './wire-rule-engine.js';

describe('wireRuleEngine', () => {
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
    notifier = new InMemoryNotifier();
    candles = new InMemoryCandleRepository();
    indicatorStore = new IndicatorSeriesStore();
  });

  it('drives a tick-cadence Price > 100 rule end-to-end and writes Fired + StateSet to both event logs', async () => {
    const ruleId = 'r1';
    await rules.save({
      id: ruleId,
      profileId: 'profile-1',
      name: 'price > 100',
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
          key: 'breached',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
      enabled: true,
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    });

    const wired = await wireRuleEngine({
      rules,
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository: candles,
      indicatorStore,
    });

    wired.tickBridge.handleQuote({
      id: 'AAPL',
      quote: { time: 1_000, price: 101, final: false },
    });
    await wired.drain();

    const ruleEvents = await eventLog.ruleEvents(ruleId);
    expect(ruleEvents.map((e) => e.type)).toEqual([RuleEventType.StateSet, RuleEventType.Fired]);
    const symbolEvents = await eventLog.symbolEvents('AAPL');
    expect(symbolEvents.map((e) => e.type)).toEqual([RuleEventType.StateSet, RuleEventType.Fired]);
    expect(await state.getSymbolState('profile-1', 'AAPL', 'breached')).toEqual({
      type: StateValueType.Bool,
      value: true,
    });
  });

  it('logs the error and appends an Error rule-event entry on the symbol log when the orchestrator throws (regression #431)', async () => {
    const captured: string[] = [];
    const sink = {
      write(line: string): void {
        captured.push(line);
      },
    };
    _resetLogRoot(sink);
    _setLogLevel('error');
    try {
      const corruptRules: typeof rules = Object.create(rules);
      corruptRules.listEnabledForSymbol = () => {
        throw new Error('repository timeout');
      };
      const wired = await wireRuleEngine({
        rules: corruptRules,
        state,
        watchlist,
        eventLog,
        notifier,
        candleRepository: candles,
        indicatorStore,
      });

      wired.tickBridge.handleQuote({
        id: 'AAPL',
        quote: { time: 1_000, price: 101, final: false },
      });
      await wired.drain();

      const symbolEvents = await eventLog.symbolEvents('AAPL');
      expect(symbolEvents).toEqual([
        {
          type: RuleEventType.Error,
          ts: 1_000,
          firedAt: 0,
          ruleId: '',
          symbolId: 'AAPL',
          reason: 'orchestrator process failed: repository timeout',
        },
      ]);
      const logged = captured.map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(
        logged.some(
          (entry) =>
            entry.scope === 'engine.rules.wire' &&
            entry.level === 50 &&
            entry.msg === 'orchestrator_process_failed' &&
            entry.symbolId === 'AAPL' &&
            typeof entry.err === 'object' &&
            entry.err !== null &&
            (entry.err as { message?: unknown }).message === 'repository timeout',
        ),
      ).toEqual(true);
    } finally {
      _resetLogRoot();
      _setLogLevel('info');
    }
  });

  it('fires a tick-cadence rule whose condition references SymbolStateRef when the state was set under the rule profile (regression #431)', async () => {
    const ruleId = 'r-state';
    const stateAwareRule: Rule = {
      id: ruleId,
      profileId: 'profile-1',
      name: 'state-aware',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.State,
          operator: StateOperator.Equals,
          left: {
            kind: OperandKind.SymbolStateRef,
            key: 'breached',
            valueType: StateValueType.Bool,
          },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.Bool, value: true },
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
          template: 'state hit',
        },
      ],
      enabled: true,
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    };
    await rules.save(stateAwareRule);

    const allowingNotifier = new InMemoryNotifier(['main']);
    const wired = await wireRuleEngine({
      rules,
      state,
      watchlist,
      eventLog,
      notifier: allowingNotifier,
      candleRepository: candles,
      indicatorStore,
    });
    // Set state under the rule's profile AFTER wiring so the sync lookups
    // mirror (subscribed in `wireRuleEngine`) sees the write — same
    // ordering the production engine uses (`warmInitialState` covers the
    // cold-start path, not exercised by this regression test).
    await state.setSymbolState(
      'profile-1',
      'AAPL',
      'breached',
      { type: StateValueType.Bool, value: true },
      0,
    );

    wired.tickBridge.handleQuote({
      id: 'AAPL',
      quote: { time: 1_000, price: 101, final: false },
    });
    await wired.drain();

    const ruleEvents = await eventLog.ruleEvents(ruleId);
    expect(ruleEvents.map((e) => e.type)).toEqual([
      RuleEventType.NotificationSent,
      RuleEventType.Fired,
    ]);
    expect(allowingNotifier.sent).toEqual([{ destinationName: 'main', body: 'state hit' }]);
  });

  it('exposes the bar bridge so a BarClosed event triggers OncePerBarClose rules', async () => {
    const ruleId = 'r2';
    await rules.save({
      id: ruleId,
      profileId: 'profile-1',
      name: 'bar close > 100',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.Comparison,
          operator: ComparisonOperator.Gt,
          left: { kind: OperandKind.Close },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.Number, value: 100 },
          },
          interval: Period.M1,
        },
      },
      trigger: { kind: TriggerKind.OncePerBarClose, period: Period.M1 },
      expiration: null,
      actions: [
        {
          kind: ActionKind.SetSymbolState,
          key: 'bar-fired',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
      enabled: true,
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    });

    await candles.save('AAPL', Period.M1, [
      { time: 60_000, open: 99, high: 102, low: 99, close: 101, volume: 10 },
    ]);

    const wired = await wireRuleEngine({
      rules,
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository: candles,
      indicatorStore,
    });

    wired.barBridge.handleCandle({
      id: 'AAPL',
      period: Period.M1,
      candle: { time: 60_000, open: 99, high: 102, low: 99, close: 101, volume: 10 },
      final: true,
    });
    await wired.drain();

    const ruleEvents = await eventLog.ruleEvents(ruleId);
    expect(ruleEvents.map((e) => e.type)).toEqual([RuleEventType.StateSet, RuleEventType.Fired]);
    expect(await state.getSymbolState('profile-1', 'AAPL', 'bar-fired')).toEqual({
      type: StateValueType.Bool,
      value: true,
    });
  });

  it('warms the sync lookups mirror with persisted symbol-state on wire-up so the seeded value is visible before any StateChangedEvent fires (regression #432)', async () => {
    await state.setSymbolState(
      'profile-1',
      'AAPL',
      'breached',
      { type: StateValueType.Bool, value: true },
      0,
    );
    await rules.save({
      id: 'r-warm',
      profileId: 'profile-1',
      name: 'warm-up',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.State,
          operator: StateOperator.Equals,
          left: {
            kind: OperandKind.SymbolStateRef,
            key: 'breached',
            valueType: StateValueType.Bool,
          },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.Bool, value: true },
          },
        },
      },
      trigger: { kind: TriggerKind.EveryTime },
      expiration: null,
      actions: [
        {
          kind: ActionKind.SetSymbolState,
          key: 'noop',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
      enabled: true,
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    });

    const wired = await wireRuleEngine({
      rules,
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository: candles,
      indicatorStore,
    });

    expect(wired.lookups.getSymbolState('profile-1', 'AAPL', 'breached')).toEqual({
      type: StateValueType.Bool,
      value: true,
    });
  });

  it('warms persisted symbol-state for every (profileId, watchedSymbolId) pair so a seeded value on a symbol no rule directly references is still visible (regression #432)', async () => {
    // Profile is discovered via the rule repository even though the rule's
    // own scope is a different symbol; MSFT is on the watchlist (added in
    // beforeEach via the helper extension below).
    await watchlist.add({ id: 'MSFT', periods: [Period.M1] });
    await state.setSymbolState(
      'profile-1',
      'MSFT',
      'armed',
      { type: StateValueType.Number, value: 7 },
      0,
    );
    await rules.save({
      id: 'r-other',
      profileId: 'profile-1',
      name: 'unrelated',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.Comparison,
          operator: ComparisonOperator.Gt,
          left: { kind: OperandKind.Price },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.Number, value: 0 },
          },
        },
      },
      trigger: { kind: TriggerKind.EveryTime },
      expiration: null,
      actions: [],
      enabled: true,
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    });

    const wired = await wireRuleEngine({
      rules,
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository: candles,
      indicatorStore,
    });

    expect(wired.lookups.getSymbolState('profile-1', 'MSFT', 'armed')).toEqual({
      type: StateValueType.Number,
      value: 7,
    });
  });

  it('warms persisted global-state for every profileId discovered from rules.list() (regression #432)', async () => {
    await state.setGlobalState('profile-1', 'regime', { type: StateValueType.Number, value: 3 }, 0);
    await rules.save({
      id: 'r-any',
      profileId: 'profile-1',
      name: 'any',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.Comparison,
          operator: ComparisonOperator.Gt,
          left: { kind: OperandKind.Price },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.Number, value: 0 },
          },
        },
      },
      trigger: { kind: TriggerKind.EveryTime },
      expiration: null,
      actions: [],
      enabled: true,
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    });

    const wired = await wireRuleEngine({
      rules,
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository: candles,
      indicatorStore,
    });

    expect(wired.lookups.getGlobalState('profile-1', 'regime')).toEqual({
      type: StateValueType.Number,
      value: 3,
    });
  });

  it('resolves cleanly with no rules persisted (no profiles to warm)', async () => {
    const wired = await wireRuleEngine({
      rules,
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository: candles,
      indicatorStore,
    });

    // Sanity: the engine is usable and the mirror is empty.
    expect(wired.lookups.getSymbolState('profile-1', 'AAPL', 'anything')).toBeNull();
    expect(wired.lookups.getGlobalState('profile-1', 'anything')).toBeNull();
  });
});
