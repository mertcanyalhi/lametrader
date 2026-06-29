import { Period, RulesV2, StateScope, StateValueType } from '@lametrader/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryCandleRepository } from '../../candles/in-memory-candle-repository.js';
import { InMemoryNotifier } from '../../rules/in-memory-notifier.js';
import { InMemoryStateRepository } from '../../state/in-memory-state-repository.js';
import { InMemoryWatchlistRepository } from '../../symbols/in-memory-watchlist-repository.js';
import { InMemoryRuleRepository } from '../dispatch/in-memory-rule-repository.js';
import { IndicatorSeriesStore } from '../indicator-series-store.js';
import { InMemoryEventLog } from '../orchestrator/in-memory-event-log.js';
import { wireRuleEngineV2 } from './wire-rule-engine-v2.js';

describe('wireRuleEngineV2', () => {
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
      actions: [
        {
          kind: RulesV2.ActionKind.SetSymbolState,
          key: 'breached',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
      enabled: true,
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    });

    const wired = wireRuleEngineV2({
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
    expect(ruleEvents.map((e) => e.type)).toEqual([
      RulesV2.RuleEventType.StateSet,
      RulesV2.RuleEventType.Fired,
    ]);
    const symbolEvents = await eventLog.symbolEvents('AAPL');
    expect(symbolEvents.map((e) => e.type)).toEqual([
      RulesV2.RuleEventType.StateSet,
      RulesV2.RuleEventType.Fired,
    ]);
    expect(await state.getSymbolState('profile-1', 'AAPL', 'breached')).toEqual({
      type: StateValueType.Bool,
      value: true,
    });
  });

  it('exposes the bar bridge so a BarClosed event triggers OncePerBarClose rules', async () => {
    const ruleId = 'r2';
    await rules.save({
      id: ruleId,
      profileId: 'profile-1',
      name: 'bar close > 100',
      scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
        kind: RulesV2.ConditionNodeKind.Leaf,
        leaf: {
          family: RulesV2.LeafConditionFamily.Comparison,
          operator: RulesV2.ComparisonOperator.Gt,
          left: { kind: RulesV2.OperandKind.Close },
          right: {
            kind: RulesV2.OperandKind.Literal,
            value: { type: StateValueType.Number, value: 100 },
          },
          interval: Period.M1,
        },
      },
      trigger: { kind: RulesV2.TriggerKind.OncePerBarClose, period: Period.M1 },
      expiration: null,
      actions: [
        {
          kind: RulesV2.ActionKind.SetSymbolState,
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

    const wired = wireRuleEngineV2({
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
    expect(ruleEvents.map((e) => e.type)).toEqual([
      RulesV2.RuleEventType.StateSet,
      RulesV2.RuleEventType.Fired,
    ]);
    expect(await state.getSymbolState('profile-1', 'AAPL', 'bar-fired')).toEqual({
      type: StateValueType.Bool,
      value: true,
    });
  });
});
