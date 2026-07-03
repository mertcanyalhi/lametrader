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
import {
  IndicatorSeriesStore,
  InMemoryCandleRepository,
  InMemoryEventLog,
  InMemoryNotifier,
  InMemoryRuleRepository,
  InMemoryStateRepository,
  InMemoryWatchlistRepository,
  wireRuleEngine,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';

describe('wireRuleEngine state-ref evaluation (e2e)', () => {
  it('a tick on a Symbol-scoped rule whose condition references SymbolStateRef fires when the state was written under the rule profile (regression #431)', async () => {
    const rules = new InMemoryRuleRepository();
    const eventLog = new InMemoryEventLog(() => 0);
    const state = new InMemoryStateRepository();
    const watchlist = new InMemoryWatchlistRepository();
    const notifier = new InMemoryNotifier(['main']);
    const candleRepository = new InMemoryCandleRepository();
    const indicatorStore = new IndicatorSeriesStore();

    const stateAwareRule: Rule = {
      id: 'r-state',
      profileId: 'profile-7',
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

    const wired = await wireRuleEngine({
      rules,
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository,
      indicatorStore,
    });
    // State is set AFTER wiring so the sync lookups mirror (subscribed via
    // `state.onStateChanged` in wireRuleEngine) observes the write.
    await state.setSymbolState(
      'profile-7',
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

    const ruleEvents = await eventLog.ruleEvents('r-state');
    expect(ruleEvents.map((e) => e.type)).toEqual([
      RuleEventType.NotificationSent,
      RuleEventType.Fired,
    ]);
    expect(notifier.sent).toEqual([{ destinationName: 'main', body: 'state hit' }]);
  });

  it('a tick fires a SymbolStateRef-reading rule after an engine restart where the state was set by a previous engine process (regression #432)', async () => {
    // Shared persistent stores survive the "restart" — the only thing the
    // simulated restart throws away is the wired engine itself (its sync
    // lookups mirror).
    const rules = new InMemoryRuleRepository();
    const eventLog = new InMemoryEventLog(() => 0);
    const state = new InMemoryStateRepository();
    const watchlist = new InMemoryWatchlistRepository();
    await watchlist.add({ id: 'AAPL', periods: [Period.M1] });
    const candleRepository = new InMemoryCandleRepository();
    const indicatorStore = new IndicatorSeriesStore();

    const stateAwareRule: Rule = {
      id: 'r-cold-state',
      profileId: 'profile-cold',
      name: 'cold-start state-aware',
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
          template: 'cold state hit',
        },
      ],
      enabled: true,
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    };
    await rules.save(stateAwareRule);
    // First engine process: persist the state slot then "shut down" (the
    // wired engine reference is dropped — we never construct it for this
    // first phase because the bug only matters across process boundaries).
    await state.setSymbolState(
      'profile-cold',
      'AAPL',
      'breached',
      { type: StateValueType.Bool, value: true },
      0,
    );

    // Second engine process: wire fresh. Without the warm-up, the sync
    // lookups mirror would be empty here and the tick below would see
    // `null` for `breached`, failing to match Equals(true).
    const notifier = new InMemoryNotifier(['main']);
    const wired = await wireRuleEngine({
      rules,
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository,
      indicatorStore,
    });

    wired.tickBridge.handleQuote({
      id: 'AAPL',
      quote: { time: 1_000, price: 101, final: false },
    });
    await wired.drain();

    const ruleEvents = await eventLog.ruleEvents('r-cold-state');
    expect(ruleEvents.map((e) => e.type)).toEqual([
      RuleEventType.NotificationSent,
      RuleEventType.Fired,
    ]);
    expect(notifier.sent).toEqual([{ destinationName: 'main', body: 'cold state hit' }]);
  });
});

describe('wireRuleEngine changed-only tick suppression (e2e, #464)', () => {
  it('a second tick at the same price drives no orchestrator pass — no listEnabledForSymbol query and no new event-log entries after the first fire', async () => {
    const rules = new InMemoryRuleRepository();
    const eventLog = new InMemoryEventLog(() => 0);
    const state = new InMemoryStateRepository();
    const watchlist = new InMemoryWatchlistRepository();
    await watchlist.add({ id: 'AAPL', periods: [Period.OneMinute] });
    const notifier = new InMemoryNotifier(['main']);
    const candleRepository = new InMemoryCandleRepository();
    const indicatorStore = new IndicatorSeriesStore();

    // EveryTime + Price > 100: without suppression a second flat tick at 101
    // would fire again — so a stable event log after it proves the tick never
    // reached the dispatcher.
    const rule: Rule = {
      id: 'r-flat',
      profileId: 'profile-flat',
      name: 'price > 100',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.Comparison,
          operator: ComparisonOperator.Gt,
          left: { kind: OperandKind.Price },
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 100 } },
        },
      },
      trigger: { kind: TriggerKind.EveryTime },
      expiration: null,
      // Notification (not a state mutation) so a fire raises no cascade event —
      // keeps the per-tick dispatcher-pass count at exactly one.
      actions: [
        {
          kind: ActionKind.Notification,
          channel: NotificationChannel.Telegram,
          destinationName: 'main',
          template: 'above',
        },
      ],
      enabled: true,
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    };
    await rules.save(rule);

    // Count dispatcher passes: the dispatcher's only per-event repo read on a
    // symbol-bearing tick is `listEnabledForSymbol`.
    let listEnabledCalls = 0;
    const countingRules: typeof rules = Object.create(rules);
    countingRules.listEnabledForSymbol = (symbolId, profileId) => {
      listEnabledCalls += 1;
      return rules.listEnabledForSymbol(symbolId, profileId);
    };

    const wired = await wireRuleEngine({
      rules: countingRules,
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository,
      indicatorStore,
    });

    wired.tickBridge.handleQuote({
      subscriptionId: 'sub-1',
      id: 'AAPL',
      period: Period.OneMinute,
      quote: { time: 1_000, price: 101, change: 0, changePct: 0 },
      final: false,
    });
    await wired.drain();

    const afterFirst = (await eventLog.symbolEvents('AAPL')).map((e) => e.type);
    expect(afterFirst).toEqual([RuleEventType.NotificationSent, RuleEventType.Fired]);
    expect(listEnabledCalls).toEqual(1);

    // Second tick, identical price → suppressed at the bridge, no orchestrator pass.
    wired.tickBridge.handleQuote({
      subscriptionId: 'sub-1',
      id: 'AAPL',
      period: Period.OneMinute,
      quote: { time: 2_000, price: 101, change: 0, changePct: 0 },
      final: false,
    });
    await wired.drain();

    expect((await eventLog.symbolEvents('AAPL')).map((e) => e.type)).toEqual([
      RuleEventType.NotificationSent,
      RuleEventType.Fired,
    ]);
    expect(listEnabledCalls).toEqual(1);
  });
});
