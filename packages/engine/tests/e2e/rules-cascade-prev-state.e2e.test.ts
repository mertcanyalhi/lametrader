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

describe('wireRuleEngine cascade prev-state threading (e2e, regression #433)', () => {
  it('rule B (ChangesTo("on")) fires from the cascade emitted by rule A (SetSymbolState phase="on") within the same tick', async () => {
    const rules = new InMemoryRuleRepository();
    const eventLog = new InMemoryEventLog(() => 0);
    const state = new InMemoryStateRepository();
    const watchlist = new InMemoryWatchlistRepository();
    await watchlist.add({ id: 'AAPL', periods: [Period.M1] });
    const notifier = new InMemoryNotifier(['main']);
    const candleRepository = new InMemoryCandleRepository();
    const indicatorStore = new IndicatorSeriesStore();

    // Rule A — Price > 100 → SetSymbolState phase='on'.
    const ruleA: Rule = {
      id: 'r-a-set-phase-on',
      profileId: 'profile-7',
      name: 'set-phase-on',
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
      // Order 0 so rule A fires before rule B on the tick path.
      order: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    // Rule B — ChangesTo(SymbolStateRef('phase'), 'on') → notification.
    const ruleB: Rule = {
      id: 'r-b-on-changes-to-on',
      profileId: 'profile-7',
      name: 'on-changes-to-on',
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
          template: 'phase changed to on',
        },
      ],
      enabled: true,
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    };
    await rules.save(ruleA);
    await rules.save(ruleB);
    // Seed phase='off' BEFORE wiring so the warm-up populates the sync mirror
    // and the trigger rule's cascade carries prev='off', current='on'.
    await state.setSymbolState(
      'profile-7',
      'AAPL',
      'phase',
      { type: StateValueType.String, value: 'off' },
      0,
    );

    const wired = await wireRuleEngine({
      rules,
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository,
      indicatorStore,
    });

    // One tick drives the whole flow: rule A fires + cascades; rule B then
    // fires from the cascade.
    wired.tickBridge.handleQuote({
      id: 'AAPL',
      quote: { time: 1_000, price: 101, final: false },
    });
    await wired.drain();

    const ruleAEvents = await eventLog.ruleEvents(ruleA.id);
    expect(ruleAEvents.map((e) => e.type)).toEqual([RuleEventType.StateSet, RuleEventType.Fired]);
    const ruleBEvents = await eventLog.ruleEvents(ruleB.id);
    expect(ruleBEvents.map((e) => e.type)).toEqual([
      RuleEventType.NotificationSent,
      RuleEventType.Fired,
    ]);
    expect(notifier.sent).toEqual([{ destinationName: 'main', body: 'phase changed to on' }]);
    expect(await state.getSymbolState('profile-7', 'AAPL', 'phase')).toEqual({
      type: StateValueType.String,
      value: 'on',
    });
  });
});
