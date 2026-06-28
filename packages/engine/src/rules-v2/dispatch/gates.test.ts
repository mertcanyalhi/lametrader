import { Period, RulesV2, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { type GateLookups, gateAllows } from './gates.js';

const tickEvent: RulesV2.EvaluationTriggerEvent = {
  kind: RulesV2.EvaluationTriggerKind.Tick,
  ts: 60_000,
  symbolId: 'BTC',
  price: 100,
};

const timerAt = (ts: number): RulesV2.EvaluationTriggerEvent => ({
  kind: RulesV2.EvaluationTriggerKind.Timer,
  ts,
});

const barOpenedAt = (period: Period, ts: number): RulesV2.EvaluationTriggerEvent => ({
  kind: RulesV2.EvaluationTriggerKind.BarOpened,
  ts,
  symbolId: 'BTC',
  period,
});

const barClosedAt = (period: Period, ts: number): RulesV2.EvaluationTriggerEvent => ({
  kind: RulesV2.EvaluationTriggerKind.BarClosed,
  ts,
  symbolId: 'BTC',
  period,
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

const buildRule = (trigger: RulesV2.Trigger): RulesV2.Rule => ({
  id: 'r1',
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

const buildLookups = (overrides: Partial<GateLookups> = {}): GateLookups => ({
  isLatched: () => false,
  lastFireAt: () => null,
  ...overrides,
});

describe('gateAllows', () => {
  it('returns true for EveryTime triggers regardless of gate-state contents', () => {
    const rule = buildRule({ kind: RulesV2.TriggerKind.EveryTime });
    const lookups = buildLookups({
      isLatched: () => true,
      lastFireAt: () => 0,
    });
    expect(gateAllows(rule, tickEvent, 'BTC', lookups)).toBe(true);
  });

  it('returns true for Once triggers (the orchestrator owns auto-disable; the gate itself never blocks)', () => {
    const rule = buildRule({ kind: RulesV2.TriggerKind.Once });
    const lookups = buildLookups({
      isLatched: () => true,
      lastFireAt: () => 0,
    });
    expect(gateAllows(rule, tickEvent, 'BTC', lookups)).toBe(true);
  });

  it('returns true for OncePerBar when the (ruleId, firingSymbolId, period) latch is clear and false when it is latched', () => {
    const rule = buildRule({ kind: RulesV2.TriggerKind.OncePerBar, period: Period.OneMinute });
    const clearLookups = buildLookups({ isLatched: () => false });
    const latchedLookups = buildLookups({
      isLatched: (ruleId, symbolId, period) =>
        ruleId === 'r1' && symbolId === 'BTC' && period === Period.OneMinute,
    });
    expect({
      clear: gateAllows(rule, tickEvent, 'BTC', clearLookups),
      latched: gateAllows(rule, tickEvent, 'BTC', latchedLookups),
    }).toEqual({ clear: true, latched: false });
  });

  it('returns true for OncePerBarOpen and OncePerBarClose on every routed call (the bar-lifecycle event itself enforces once-per-bar)', () => {
    const openRule = buildRule({
      kind: RulesV2.TriggerKind.OncePerBarOpen,
      period: Period.OneMinute,
    });
    const closeRule = buildRule({
      kind: RulesV2.TriggerKind.OncePerBarClose,
      period: Period.OneMinute,
    });
    const lookups = buildLookups();
    expect({
      open: gateAllows(openRule, barOpenedAt(Period.OneMinute, 60_000), 'BTC', lookups),
      close: gateAllows(closeRule, barClosedAt(Period.OneMinute, 60_000), 'BTC', lookups),
    }).toEqual({ open: true, close: true });
  });

  it('returns true for OncePerInterval when no prior fire is recorded or when event.ts - lastFireAt >= intervalMs, and false when fewer than intervalMs have elapsed', () => {
    const rule = buildRule({ kind: RulesV2.TriggerKind.OncePerInterval, intervalMs: 60_000 });
    const neverFired = buildLookups({ lastFireAt: () => null });
    const longAgo = buildLookups({ lastFireAt: () => 0 });
    const exactlyIntervalAgo = buildLookups({ lastFireAt: () => 60_000 - 60_000 });
    const tooRecent = buildLookups({ lastFireAt: () => 60_000 - 30_000 });
    expect({
      neverFired: gateAllows(rule, timerAt(60_000), 'BTC', neverFired),
      longAgo: gateAllows(rule, timerAt(60_000), 'BTC', longAgo),
      exactlyIntervalAgo: gateAllows(rule, timerAt(60_000), 'BTC', exactlyIntervalAgo),
      tooRecent: gateAllows(rule, timerAt(60_000), 'BTC', tooRecent),
    }).toEqual({
      neverFired: true,
      longAgo: true,
      exactlyIntervalAgo: true,
      tooRecent: false,
    });
  });
});
