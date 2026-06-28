import { Period, RulesV2, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { routes } from './routes.js';

const tickEvent: RulesV2.EvaluationTriggerEvent = {
  kind: RulesV2.EvaluationTriggerKind.Tick,
  ts: 1_000,
  symbolId: 'BTC',
  price: 100,
};

const barOpened = (period: Period): RulesV2.EvaluationTriggerEvent => ({
  kind: RulesV2.EvaluationTriggerKind.BarOpened,
  ts: 1_000,
  symbolId: 'BTC',
  period,
});

const barClosed = (period: Period): RulesV2.EvaluationTriggerEvent => ({
  kind: RulesV2.EvaluationTriggerKind.BarClosed,
  ts: 1_000,
  symbolId: 'BTC',
  period,
});

const timerEvent: RulesV2.EvaluationTriggerEvent = {
  kind: RulesV2.EvaluationTriggerKind.Timer,
  ts: 1_000,
};

const symbolStateChanged = (key: string): RulesV2.EvaluationTriggerEvent => ({
  kind: RulesV2.EvaluationTriggerKind.SymbolStateChanged,
  ts: 1_000,
  symbolId: 'BTC',
  profileId: 'p1',
  key,
  prev: null,
  current: { type: StateValueType.String, value: 'up' },
});

const globalStateChanged = (key: string): RulesV2.EvaluationTriggerEvent => ({
  kind: RulesV2.EvaluationTriggerKind.GlobalStateChanged,
  ts: 1_000,
  profileId: 'p1',
  key,
  prev: null,
  current: { type: StateValueType.String, value: 'risk-on' },
});

const indicatorChanged = (
  instanceId: string,
  stateKey: string,
): RulesV2.EvaluationTriggerEvent => ({
  kind: RulesV2.EvaluationTriggerKind.IndicatorChanged,
  ts: 1_000,
  symbolId: 'BTC',
  instanceId,
  stateKey,
  prev: null,
  current: { type: StateValueType.Number, value: 42 },
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

const symbolStateEqualsCondition = (key: string): RulesV2.ConditionNode => ({
  kind: RulesV2.ConditionNodeKind.Leaf,
  leaf: {
    family: RulesV2.LeafConditionFamily.State,
    operator: RulesV2.StateOperator.Equals,
    left: { kind: RulesV2.OperandKind.SymbolStateRef, key, valueType: StateValueType.String },
    right: {
      kind: RulesV2.OperandKind.Literal,
      value: { type: StateValueType.String, value: 'up' },
    },
  },
});

const globalStateEqualsCondition = (key: string): RulesV2.ConditionNode => ({
  kind: RulesV2.ConditionNodeKind.Leaf,
  leaf: {
    family: RulesV2.LeafConditionFamily.State,
    operator: RulesV2.StateOperator.Equals,
    left: { kind: RulesV2.OperandKind.GlobalStateRef, key, valueType: StateValueType.String },
    right: {
      kind: RulesV2.OperandKind.Literal,
      value: { type: StateValueType.String, value: 'risk-on' },
    },
  },
});

const indicatorRefCondition = (instanceId: string, stateKey: string): RulesV2.ConditionNode => ({
  kind: RulesV2.ConditionNodeKind.Leaf,
  leaf: {
    family: RulesV2.LeafConditionFamily.Comparison,
    operator: RulesV2.ComparisonOperator.Gt,
    left: {
      kind: RulesV2.OperandKind.IndicatorRef,
      instanceId,
      stateKey,
      valueType: StateValueType.Number,
    },
    right: { kind: RulesV2.OperandKind.Literal, value: { type: StateValueType.Number, value: 50 } },
  },
});

const buildRule = (trigger: RulesV2.Trigger, condition: RulesV2.ConditionNode): RulesV2.Rule => ({
  id: 'r1',
  profileId: 'p1',
  name: 'rule',
  scope: { kind: RulesV2.RuleScopeKind.AllSymbols },
  condition,
  trigger,
  expiration: null,
  actions: [],
  enabled: true,
  order: 0,
  createdAt: 0,
  updatedAt: 0,
});

describe('routes', () => {
  it('returns true for Tick against every tick-cadence trigger (EveryTime / Once / OncePerBar) and false against bar-cadence or periodic triggers', () => {
    const everyTime = buildRule({ kind: RulesV2.TriggerKind.EveryTime }, priceGtLiteralCondition);
    const once = buildRule({ kind: RulesV2.TriggerKind.Once }, priceGtLiteralCondition);
    const oncePerBar = buildRule(
      { kind: RulesV2.TriggerKind.OncePerBar, period: Period.OneMinute },
      priceGtLiteralCondition,
    );
    const oncePerBarOpen = buildRule(
      { kind: RulesV2.TriggerKind.OncePerBarOpen, period: Period.OneMinute },
      priceGtLiteralCondition,
    );
    const oncePerBarClose = buildRule(
      { kind: RulesV2.TriggerKind.OncePerBarClose, period: Period.OneMinute },
      priceGtLiteralCondition,
    );
    const oncePerInterval = buildRule(
      { kind: RulesV2.TriggerKind.OncePerInterval, intervalMs: 60_000 },
      priceGtLiteralCondition,
    );
    expect({
      everyTime: routes(tickEvent, everyTime),
      once: routes(tickEvent, once),
      oncePerBar: routes(tickEvent, oncePerBar),
      oncePerBarOpen: routes(tickEvent, oncePerBarOpen),
      oncePerBarClose: routes(tickEvent, oncePerBarClose),
      oncePerInterval: routes(tickEvent, oncePerInterval),
    }).toEqual({
      everyTime: true,
      once: true,
      oncePerBar: true,
      oncePerBarOpen: false,
      oncePerBarClose: false,
      oncePerInterval: false,
    });
  });

  it('returns true for BarOpened only against OncePerBarOpen triggers whose period matches and false for any other trigger or period mismatch', () => {
    const oncePerBarOpenMatching = buildRule(
      { kind: RulesV2.TriggerKind.OncePerBarOpen, period: Period.OneMinute },
      priceGtLiteralCondition,
    );
    const oncePerBarOpenMismatch = buildRule(
      { kind: RulesV2.TriggerKind.OncePerBarOpen, period: Period.FiveMinutes },
      priceGtLiteralCondition,
    );
    const oncePerBarCloseMatching = buildRule(
      { kind: RulesV2.TriggerKind.OncePerBarClose, period: Period.OneMinute },
      priceGtLiteralCondition,
    );
    const everyTime = buildRule({ kind: RulesV2.TriggerKind.EveryTime }, priceGtLiteralCondition);
    expect({
      oncePerBarOpenMatching: routes(barOpened(Period.OneMinute), oncePerBarOpenMatching),
      oncePerBarOpenMismatch: routes(barOpened(Period.OneMinute), oncePerBarOpenMismatch),
      oncePerBarCloseMatching: routes(barOpened(Period.OneMinute), oncePerBarCloseMatching),
      everyTime: routes(barOpened(Period.OneMinute), everyTime),
    }).toEqual({
      oncePerBarOpenMatching: true,
      oncePerBarOpenMismatch: false,
      oncePerBarCloseMatching: false,
      everyTime: false,
    });
  });

  it('returns true for BarClosed only against OncePerBarClose triggers whose period matches and false for any other trigger or period mismatch', () => {
    const oncePerBarCloseMatching = buildRule(
      { kind: RulesV2.TriggerKind.OncePerBarClose, period: Period.OneMinute },
      priceGtLiteralCondition,
    );
    const oncePerBarCloseMismatch = buildRule(
      { kind: RulesV2.TriggerKind.OncePerBarClose, period: Period.FiveMinutes },
      priceGtLiteralCondition,
    );
    const oncePerBarOpenMatching = buildRule(
      { kind: RulesV2.TriggerKind.OncePerBarOpen, period: Period.OneMinute },
      priceGtLiteralCondition,
    );
    const everyTime = buildRule({ kind: RulesV2.TriggerKind.EveryTime }, priceGtLiteralCondition);
    expect({
      oncePerBarCloseMatching: routes(barClosed(Period.OneMinute), oncePerBarCloseMatching),
      oncePerBarCloseMismatch: routes(barClosed(Period.OneMinute), oncePerBarCloseMismatch),
      oncePerBarOpenMatching: routes(barClosed(Period.OneMinute), oncePerBarOpenMatching),
      everyTime: routes(barClosed(Period.OneMinute), everyTime),
    }).toEqual({
      oncePerBarCloseMatching: true,
      oncePerBarCloseMismatch: false,
      oncePerBarOpenMatching: false,
      everyTime: false,
    });
  });

  it('returns true for Timer against OncePerInterval triggers and false against every other trigger kind', () => {
    const oncePerInterval = buildRule(
      { kind: RulesV2.TriggerKind.OncePerInterval, intervalMs: 60_000 },
      priceGtLiteralCondition,
    );
    const everyTime = buildRule({ kind: RulesV2.TriggerKind.EveryTime }, priceGtLiteralCondition);
    const oncePerBarOpen = buildRule(
      { kind: RulesV2.TriggerKind.OncePerBarOpen, period: Period.OneMinute },
      priceGtLiteralCondition,
    );
    expect({
      oncePerInterval: routes(timerEvent, oncePerInterval),
      everyTime: routes(timerEvent, everyTime),
      oncePerBarOpen: routes(timerEvent, oncePerBarOpen),
    }).toEqual({
      oncePerInterval: true,
      everyTime: false,
      oncePerBarOpen: false,
    });
  });

  it("returns true for SymbolStateChanged iff the rule's condition tree contains a SymbolStateRef whose key matches the event", () => {
    const triggerEveryTime: RulesV2.Trigger = { kind: RulesV2.TriggerKind.EveryTime };
    const matchingKey = buildRule(triggerEveryTime, symbolStateEqualsCondition('trend'));
    const wrongKey = buildRule(triggerEveryTime, symbolStateEqualsCondition('mood'));
    const nestedInsideAnd = buildRule(triggerEveryTime, {
      kind: RulesV2.ConditionNodeKind.And,
      children: [priceGtLiteralCondition, symbolStateEqualsCondition('trend')],
    });
    const noSymbolStateRef = buildRule(triggerEveryTime, priceGtLiteralCondition);
    const globalRefOnly = buildRule(triggerEveryTime, globalStateEqualsCondition('trend'));
    expect({
      matchingKey: routes(symbolStateChanged('trend'), matchingKey),
      wrongKey: routes(symbolStateChanged('trend'), wrongKey),
      nestedInsideAnd: routes(symbolStateChanged('trend'), nestedInsideAnd),
      noSymbolStateRef: routes(symbolStateChanged('trend'), noSymbolStateRef),
      globalRefOnly: routes(symbolStateChanged('trend'), globalRefOnly),
    }).toEqual({
      matchingKey: true,
      wrongKey: false,
      nestedInsideAnd: true,
      noSymbolStateRef: false,
      globalRefOnly: false,
    });
  });

  it("returns true for GlobalStateChanged iff the rule's condition tree contains a GlobalStateRef whose key matches the event", () => {
    const triggerEveryTime: RulesV2.Trigger = { kind: RulesV2.TriggerKind.EveryTime };
    const matchingKey = buildRule(triggerEveryTime, globalStateEqualsCondition('regime'));
    const wrongKey = buildRule(triggerEveryTime, globalStateEqualsCondition('mood'));
    const nestedInsideOr = buildRule(triggerEveryTime, {
      kind: RulesV2.ConditionNodeKind.Or,
      children: [priceGtLiteralCondition, globalStateEqualsCondition('regime')],
    });
    const noGlobalStateRef = buildRule(triggerEveryTime, priceGtLiteralCondition);
    const symbolRefOnly = buildRule(triggerEveryTime, symbolStateEqualsCondition('regime'));
    expect({
      matchingKey: routes(globalStateChanged('regime'), matchingKey),
      wrongKey: routes(globalStateChanged('regime'), wrongKey),
      nestedInsideOr: routes(globalStateChanged('regime'), nestedInsideOr),
      noGlobalStateRef: routes(globalStateChanged('regime'), noGlobalStateRef),
      symbolRefOnly: routes(globalStateChanged('regime'), symbolRefOnly),
    }).toEqual({
      matchingKey: true,
      wrongKey: false,
      nestedInsideOr: true,
      noGlobalStateRef: false,
      symbolRefOnly: false,
    });
  });

  it("returns true for IndicatorChanged iff the rule's condition tree contains an IndicatorRef whose instanceId+stateKey match the event", () => {
    const triggerEveryTime: RulesV2.Trigger = { kind: RulesV2.TriggerKind.EveryTime };
    const matching = buildRule(triggerEveryTime, indicatorRefCondition('sma-1', 'value'));
    const wrongInstance = buildRule(triggerEveryTime, indicatorRefCondition('sma-2', 'value'));
    const wrongStateKey = buildRule(triggerEveryTime, indicatorRefCondition('sma-1', 'slope'));
    const nestedInsideChannel: RulesV2.ConditionNode = {
      kind: RulesV2.ConditionNodeKind.Leaf,
      leaf: {
        family: RulesV2.LeafConditionFamily.Channel,
        operator: RulesV2.ChannelOperator.InsideChannel,
        left: { kind: RulesV2.OperandKind.Price },
        lower: {
          kind: RulesV2.OperandKind.IndicatorRef,
          instanceId: 'sma-1',
          stateKey: 'value',
          valueType: StateValueType.Number,
        },
        upper: {
          kind: RulesV2.OperandKind.Literal,
          value: { type: StateValueType.Number, value: 130 },
        },
      },
    };
    const nestedRule = buildRule(triggerEveryTime, nestedInsideChannel);
    expect({
      matching: routes(indicatorChanged('sma-1', 'value'), matching),
      wrongInstance: routes(indicatorChanged('sma-1', 'value'), wrongInstance),
      wrongStateKey: routes(indicatorChanged('sma-1', 'value'), wrongStateKey),
      nestedInsideChannel: routes(indicatorChanged('sma-1', 'value'), nestedRule),
    }).toEqual({
      matching: true,
      wrongInstance: false,
      wrongStateKey: false,
      nestedInsideChannel: true,
    });
  });
});
