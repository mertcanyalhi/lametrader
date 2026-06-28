import { Period, RulesV2, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { TriggerDispatcher } from './dispatcher.js';

const tickEventAt = (ts: number): RulesV2.EvaluationTriggerEvent => ({
  kind: RulesV2.EvaluationTriggerKind.Tick,
  ts,
  symbolId: 'BTC',
  price: 100,
});

const timerEventAt = (ts: number): RulesV2.EvaluationTriggerEvent => ({
  kind: RulesV2.EvaluationTriggerKind.Timer,
  ts,
});

const priceGtLiteralCondition: RulesV2.ConditionNode = {
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

const buildRule = (id: string, trigger: RulesV2.Trigger): RulesV2.Rule => ({
  id,
  profileId: 'p1',
  name: 'rule',
  scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' },
  condition: priceGtLiteralCondition,
  trigger,
  expiration: null,
  actions: [],
  enabled: true,
  order: 0,
  createdAt: 0,
  updatedAt: 0,
});

describe('TriggerDispatcher', () => {
  it('decide returns true only when the event routes to the rule, the condition is true, and the per-trigger gate allows the fire', () => {
    const dispatcher = new TriggerDispatcher();
    const rule = buildRule('r1', { kind: RulesV2.TriggerKind.EveryTime });
    const wrongTriggerRule = buildRule('r2', {
      kind: RulesV2.TriggerKind.OncePerBarOpen,
      period: Period.OneMinute,
    });
    const tick = tickEventAt(1_000);
    expect({
      routedConditionTrue: dispatcher.decide(rule, tick, 'BTC', true),
      routedConditionFalse: dispatcher.decide(rule, tick, 'BTC', false),
      notRouted: dispatcher.decide(wrongTriggerRule, tick, 'BTC', true),
    }).toEqual({
      routedConditionTrue: true,
      routedConditionFalse: false,
      notRouted: false,
    });
  });

  it('recordFire latches OncePerBar for (rule, symbol, period) so the next decide in the same bar returns false, and records OncePerInterval last-fire so the next decide within intervalMs returns false', () => {
    const dispatcher = new TriggerDispatcher();
    const oncePerBar = buildRule('opb', {
      kind: RulesV2.TriggerKind.OncePerBar,
      period: Period.OneMinute,
    });
    const oncePerInterval = buildRule('opi', {
      kind: RulesV2.TriggerKind.OncePerInterval,
      intervalMs: 60_000,
    });
    const beforeBar = dispatcher.decide(oncePerBar, tickEventAt(1_000), 'BTC', true);
    dispatcher.recordFire(oncePerBar, tickEventAt(1_000), 'BTC');
    const afterBarSameWindow = dispatcher.decide(oncePerBar, tickEventAt(2_000), 'BTC', true);

    const beforeInterval = dispatcher.decide(oncePerInterval, timerEventAt(60_000), 'BTC', true);
    dispatcher.recordFire(oncePerInterval, timerEventAt(60_000), 'BTC');
    const afterIntervalTooRecent = dispatcher.decide(
      oncePerInterval,
      timerEventAt(90_000),
      'BTC',
      true,
    );
    const afterIntervalElapsed = dispatcher.decide(
      oncePerInterval,
      timerEventAt(120_000),
      'BTC',
      true,
    );
    expect({
      beforeBar,
      afterBarSameWindow,
      beforeInterval,
      afterIntervalTooRecent,
      afterIntervalElapsed,
    }).toEqual({
      beforeBar: true,
      afterBarSameWindow: false,
      beforeInterval: true,
      afterIntervalTooRecent: false,
      afterIntervalElapsed: true,
    });
  });

  it('onBarOpened clears every OncePerBar latch whose (symbolId, period) matches, re-arming the gate for the next bar window', () => {
    const dispatcher = new TriggerDispatcher();
    const ruleA = buildRule('a', {
      kind: RulesV2.TriggerKind.OncePerBar,
      period: Period.OneMinute,
    });
    const ruleB = buildRule('b', {
      kind: RulesV2.TriggerKind.OncePerBar,
      period: Period.OneMinute,
    });
    const ruleOtherPeriod = buildRule('c', {
      kind: RulesV2.TriggerKind.OncePerBar,
      period: Period.FiveMinutes,
    });
    dispatcher.recordFire(ruleA, tickEventAt(1_000), 'BTC');
    dispatcher.recordFire(ruleB, tickEventAt(1_000), 'BTC');
    dispatcher.recordFire(ruleOtherPeriod, tickEventAt(1_000), 'BTC');
    dispatcher.recordFire(ruleA, tickEventAt(1_000), 'ETH');

    const beforeReset = {
      aBtc: dispatcher.decide(ruleA, tickEventAt(2_000), 'BTC', true),
      bBtc: dispatcher.decide(ruleB, tickEventAt(2_000), 'BTC', true),
      cBtc: dispatcher.decide(ruleOtherPeriod, tickEventAt(2_000), 'BTC', true),
      aEth: dispatcher.decide(ruleA, tickEventAt(2_000), 'ETH', true),
    };

    dispatcher.onBarOpened('BTC', Period.OneMinute);

    const afterReset = {
      aBtc: dispatcher.decide(ruleA, tickEventAt(60_001), 'BTC', true),
      bBtc: dispatcher.decide(ruleB, tickEventAt(60_001), 'BTC', true),
      cBtc: dispatcher.decide(ruleOtherPeriod, tickEventAt(60_001), 'BTC', true),
      aEth: dispatcher.decide(ruleA, tickEventAt(60_001), 'ETH', true),
    };
    expect({ beforeReset, afterReset }).toEqual({
      beforeReset: { aBtc: false, bBtc: false, cBtc: false, aEth: false },
      afterReset: { aBtc: true, bBtc: true, cBtc: false, aEth: false },
    });
  });
});
