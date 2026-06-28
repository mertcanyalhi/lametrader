import { Period, RulesV2, type StateValue, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import type { EvaluationContext } from '../evaluation-context.types.js';
import type { SeriesView } from '../series.types.js';
import { TriggerDispatcher } from './dispatcher.js';
import { InMemoryRuleRepository } from './in-memory-rule-repository.js';

const EMPTY_SERIES: SeriesView = {
  length: 0,
  backwardWalk: () => [].values(),
  asOf: () => null,
};

/**
 * Build a fake context that resolves Price to `price` and Literals to their
 * own value; every other operand resolves to `null` (no other operand is read
 * by the dispatcher's tests).
 */
function priceContext(price: number, symbolId = 'AAPL'): EvaluationContext {
  return {
    symbolId,
    resolveLatest(operand) {
      if (operand.kind === RulesV2.OperandKind.Price)
        return { type: StateValueType.Number, value: price } as StateValue;
      if (operand.kind === RulesV2.OperandKind.Literal) return operand.value;
      return null;
    },
    resolvePrev(operand) {
      if (operand.kind === RulesV2.OperandKind.Literal) return operand.value;
      return null;
    },
    resolveSeries() {
      return EMPTY_SERIES;
    },
  };
}

function priceGtLiteral(rhs: number): RulesV2.ConditionNode {
  return {
    kind: RulesV2.ConditionNodeKind.Leaf,
    leaf: {
      family: RulesV2.LeafConditionFamily.Comparison,
      operator: RulesV2.ComparisonOperator.Gt,
      left: { kind: RulesV2.OperandKind.Price },
      right: {
        kind: RulesV2.OperandKind.Literal,
        value: { type: StateValueType.Number, value: rhs },
      },
    },
  };
}

function rule(overrides: Partial<RulesV2.Rule>): RulesV2.Rule {
  return {
    id: 'r1',
    profileId: 'profile-1',
    name: 'Test rule',
    scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'AAPL' },
    condition: priceGtLiteral(100),
    trigger: { kind: RulesV2.TriggerKind.EveryTime },
    expiration: null,
    actions: [
      {
        kind: RulesV2.ActionKind.Notification,
        channel: RulesV2.NotificationChannel.Telegram,
        destinationName: 'main',
        template: 'price up',
      },
    ],
    enabled: true,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

interface SetupOptions {
  rules: RulesV2.Rule[];
  /** Defaults to a price=120 context for every event. */
  buildContext?: (event: RulesV2.RuleEvent, firingSymbolId: string) => EvaluationContext;
}

async function setup(opts: SetupOptions) {
  const repo = new InMemoryRuleRepository();
  for (const r of opts.rules) await repo.save(r);
  const dispatcher = new TriggerDispatcher({
    rules: repo,
    buildContext: opts.buildContext ?? (() => priceContext(120)),
  });
  return { repo, dispatcher };
}

const TICK_EVENT_AT = (ts: number, price = 120): RulesV2.TickEvent => ({
  kind: RulesV2.EvaluationTriggerKind.Tick,
  ts,
  symbolId: 'AAPL',
  price,
});

const BAR_OPENED = (ts: number, period: Period): RulesV2.BarOpenedEvent => ({
  kind: RulesV2.EvaluationTriggerKind.BarOpened,
  ts,
  symbolId: 'AAPL',
  period,
});

const BAR_CLOSED = (ts: number, period: Period): RulesV2.BarClosedEvent => ({
  kind: RulesV2.EvaluationTriggerKind.BarClosed,
  ts,
  symbolId: 'AAPL',
  period,
});

const TIMER_EVENT = (ts: number): RulesV2.TimerEvent => ({
  kind: RulesV2.EvaluationTriggerKind.Timer,
  ts,
});

describe('TriggerDispatcher — routing exclusivity', () => {
  it('a Tick event fires an EveryTime rule', async () => {
    const r = rule({ trigger: { kind: RulesV2.TriggerKind.EveryTime } });
    const { dispatcher } = await setup({ rules: [r] });
    const fires = await dispatcher.dispatch(TICK_EVENT_AT(1_000));
    expect(fires.map((f) => f.ruleId)).toEqual(['r1']);
  });

  it('a Tick event does NOT fire a OncePerBarOpen rule', async () => {
    const r = rule({
      trigger: { kind: RulesV2.TriggerKind.OncePerBarOpen, period: Period.OneMinute },
    });
    const { dispatcher } = await setup({ rules: [r] });
    const fires = await dispatcher.dispatch(TICK_EVENT_AT(1_000));
    expect(fires).toEqual([]);
  });

  it('a BarOpened event does NOT fire an EveryTime rule', async () => {
    const r = rule({ trigger: { kind: RulesV2.TriggerKind.EveryTime } });
    const { dispatcher } = await setup({ rules: [r] });
    const fires = await dispatcher.dispatch(BAR_OPENED(60_000, Period.OneMinute));
    expect(fires).toEqual([]);
  });
});

describe('TriggerDispatcher — bar-cadence triggers', () => {
  it('a BarOpened on matching period fires a OncePerBarOpen rule', async () => {
    const r = rule({
      trigger: { kind: RulesV2.TriggerKind.OncePerBarOpen, period: Period.OneMinute },
    });
    const { dispatcher } = await setup({ rules: [r] });
    const fires = await dispatcher.dispatch(BAR_OPENED(60_000, Period.OneMinute));
    expect(fires.map((f) => f.ruleId)).toEqual(['r1']);
  });

  it('a BarOpened on a different period does NOT fire a OncePerBarOpen rule', async () => {
    const r = rule({
      trigger: { kind: RulesV2.TriggerKind.OncePerBarOpen, period: Period.OneMinute },
    });
    const { dispatcher } = await setup({ rules: [r] });
    const fires = await dispatcher.dispatch(BAR_OPENED(60_000, Period.FiveMinutes));
    expect(fires).toEqual([]);
  });

  it('a BarClosed on matching period fires a OncePerBarClose rule', async () => {
    const r = rule({
      trigger: { kind: RulesV2.TriggerKind.OncePerBarClose, period: Period.OneMinute },
    });
    const { dispatcher } = await setup({ rules: [r] });
    const fires = await dispatcher.dispatch(BAR_CLOSED(60_000, Period.OneMinute));
    expect(fires.map((f) => f.ruleId)).toEqual(['r1']);
  });
});

describe('TriggerDispatcher — OncePerBar latch', () => {
  it('fires on the first matching tick within a bar', async () => {
    const r = rule({
      trigger: { kind: RulesV2.TriggerKind.OncePerBar, period: Period.OneMinute },
    });
    const { dispatcher } = await setup({ rules: [r] });
    const fires = await dispatcher.dispatch(TICK_EVENT_AT(1_000));
    expect(fires.map((f) => f.ruleId)).toEqual(['r1']);
  });

  it('suppresses a second matching tick within the same bar', async () => {
    const r = rule({
      trigger: { kind: RulesV2.TriggerKind.OncePerBar, period: Period.OneMinute },
    });
    const { dispatcher } = await setup({ rules: [r] });
    await dispatcher.dispatch(TICK_EVENT_AT(1_000));
    const fires = await dispatcher.dispatch(TICK_EVENT_AT(2_000));
    expect(fires).toEqual([]);
  });

  it('re-arms on the next BarOpened for the trigger period', async () => {
    const r = rule({
      trigger: { kind: RulesV2.TriggerKind.OncePerBar, period: Period.OneMinute },
    });
    const { dispatcher } = await setup({ rules: [r] });
    await dispatcher.dispatch(TICK_EVENT_AT(1_000));
    await dispatcher.dispatch(BAR_OPENED(60_000, Period.OneMinute));
    const fires = await dispatcher.dispatch(TICK_EVENT_AT(61_000));
    expect(fires.map((f) => f.ruleId)).toEqual(['r1']);
  });

  it('does NOT re-arm on a BarOpened for a different period', async () => {
    const r = rule({
      trigger: { kind: RulesV2.TriggerKind.OncePerBar, period: Period.OneMinute },
    });
    const { dispatcher } = await setup({ rules: [r] });
    await dispatcher.dispatch(TICK_EVENT_AT(1_000));
    await dispatcher.dispatch(BAR_OPENED(60_000, Period.FiveMinutes));
    const fires = await dispatcher.dispatch(TICK_EVENT_AT(61_000));
    expect(fires).toEqual([]);
  });
});

describe('TriggerDispatcher — Once auto-disable', () => {
  it('saves the rule with enabled: false on first fire', async () => {
    const r = rule({ trigger: { kind: RulesV2.TriggerKind.Once } });
    const { repo, dispatcher } = await setup({ rules: [r] });
    await dispatcher.dispatch(TICK_EVENT_AT(1_000));
    const fetched = await repo.get('r1');
    expect(fetched?.enabled).toEqual(false);
  });

  it('does not fire again on the next matching tick (listEnabledForSymbol excludes it)', async () => {
    const r = rule({ trigger: { kind: RulesV2.TriggerKind.Once } });
    const { dispatcher } = await setup({ rules: [r] });
    await dispatcher.dispatch(TICK_EVENT_AT(1_000));
    const fires = await dispatcher.dispatch(TICK_EVENT_AT(2_000));
    expect(fires).toEqual([]);
  });
});

describe('TriggerDispatcher — condition gating', () => {
  it('does not fire when the condition is false', async () => {
    const r = rule({ trigger: { kind: RulesV2.TriggerKind.EveryTime } });
    const { dispatcher } = await setup({
      rules: [r],
      buildContext: () => priceContext(80),
    });
    const fires = await dispatcher.dispatch(TICK_EVENT_AT(1_000, 80));
    expect(fires).toEqual([]);
  });
});

describe('TriggerDispatcher — empty-repo no-op', () => {
  it('returns an empty fire list and does not throw when no rules match', async () => {
    const { dispatcher } = await setup({ rules: [] });
    const fires = await dispatcher.dispatch(TICK_EVENT_AT(1_000));
    expect(fires).toEqual([]);
  });
});

describe('TriggerDispatcher — OncePerInterval gate', () => {
  it('fires a OncePerInterval rule on a Timer event when intervalMs has elapsed since last fire', async () => {
    const r = rule({
      trigger: { kind: RulesV2.TriggerKind.OncePerInterval, intervalMs: 60_000 },
    });
    const { dispatcher } = await setup({ rules: [r] });
    // Timer events have no symbol; the orchestrator's watchlist supplies the
    // expansion set, so we pass the rule's own symbol here.
    const fires = await dispatcher.dispatch(TIMER_EVENT(60_000), {
      watchedSymbolIds: ['AAPL'],
    });
    expect(fires.map((f) => f.ruleId)).toEqual(['r1']);
  });

  it('Timer events fan out across watched symbols for an AllSymbols rule', async () => {
    // Lazy: Timer events carry no symbolId — for AllSymbols-scoped rules,
    // the dispatcher uses the rule's symbolIds via firingSymbolIds option.
    const r = rule({
      scope: { kind: RulesV2.RuleScopeKind.AllSymbols },
      trigger: { kind: RulesV2.TriggerKind.OncePerInterval, intervalMs: 60_000 },
    });
    const { dispatcher } = await setup({
      rules: [r],
      buildContext: (_event, symbolId) => priceContext(120, symbolId),
    });
    const fires = await dispatcher.dispatch(TIMER_EVENT(60_000), {
      watchedSymbolIds: ['AAPL', 'MSFT'],
    });
    expect(fires.map((f) => `${f.ruleId}@${f.firingSymbolId}`)).toEqual(['r1@AAPL', 'r1@MSFT']);
  });
});

describe('TriggerDispatcher — cascade slot routing', () => {
  it('a SymbolStateChanged event fires only rules whose condition references the changed key', async () => {
    const reading: RulesV2.Rule = rule({
      id: 'reader',
      condition: {
        kind: RulesV2.ConditionNodeKind.Leaf,
        leaf: {
          family: RulesV2.LeafConditionFamily.State,
          operator: RulesV2.StateOperator.Equals,
          left: {
            kind: RulesV2.OperandKind.SymbolStateRef,
            key: 'mood',
            valueType: StateValueType.Bool,
          },
          right: {
            kind: RulesV2.OperandKind.Literal,
            value: { type: StateValueType.Bool, value: true },
          },
        },
      },
    });
    const unrelated: RulesV2.Rule = rule({
      id: 'unrelated',
      condition: {
        kind: RulesV2.ConditionNodeKind.Leaf,
        leaf: {
          family: RulesV2.LeafConditionFamily.State,
          operator: RulesV2.StateOperator.Equals,
          left: {
            kind: RulesV2.OperandKind.SymbolStateRef,
            key: 'other',
            valueType: StateValueType.Bool,
          },
          right: {
            kind: RulesV2.OperandKind.Literal,
            value: { type: StateValueType.Bool, value: true },
          },
        },
      },
    });
    const { dispatcher } = await setup({
      rules: [reading, unrelated],
      buildContext: () => ({
        symbolId: 'AAPL',
        resolveLatest(operand) {
          if (operand.kind === RulesV2.OperandKind.Literal) return operand.value;
          if (operand.kind === RulesV2.OperandKind.SymbolStateRef && operand.key === 'mood')
            return { type: StateValueType.Bool, value: true } as StateValue;
          if (operand.kind === RulesV2.OperandKind.SymbolStateRef && operand.key === 'other')
            return { type: StateValueType.Bool, value: true } as StateValue;
          return null;
        },
        resolvePrev(operand) {
          if (operand.kind === RulesV2.OperandKind.Literal) return operand.value;
          return null;
        },
        resolveSeries: () => EMPTY_SERIES,
      }),
    });
    const event: RulesV2.SymbolStateChangedEvent = {
      kind: RulesV2.EvaluationTriggerKind.SymbolStateChanged,
      ts: 1_000,
      symbolId: 'AAPL',
      profileId: 'profile-1',
      key: 'mood',
      prev: null,
      current: { type: StateValueType.Bool, value: true },
    };
    const fires = await dispatcher.dispatch(event);
    expect(fires.map((f) => f.ruleId)).toEqual(['reader']);
  });

  it('a GlobalStateChanged event fires only rules whose condition references the changed key', async () => {
    const reading = rule({
      id: 'reader',
      condition: {
        kind: RulesV2.ConditionNodeKind.Leaf,
        leaf: {
          family: RulesV2.LeafConditionFamily.State,
          operator: RulesV2.StateOperator.Equals,
          left: {
            kind: RulesV2.OperandKind.GlobalStateRef,
            key: 'mood',
            valueType: StateValueType.Bool,
          },
          right: {
            kind: RulesV2.OperandKind.Literal,
            value: { type: StateValueType.Bool, value: true },
          },
        },
      },
    });
    const unrelated = rule({
      id: 'unrelated',
      condition: {
        kind: RulesV2.ConditionNodeKind.Leaf,
        leaf: {
          family: RulesV2.LeafConditionFamily.State,
          operator: RulesV2.StateOperator.Equals,
          left: {
            kind: RulesV2.OperandKind.GlobalStateRef,
            key: 'other',
            valueType: StateValueType.Bool,
          },
          right: {
            kind: RulesV2.OperandKind.Literal,
            value: { type: StateValueType.Bool, value: true },
          },
        },
      },
    });
    const { dispatcher } = await setup({
      rules: [reading, unrelated],
      buildContext: () => ({
        symbolId: 'AAPL',
        resolveLatest(operand) {
          if (operand.kind === RulesV2.OperandKind.Literal) return operand.value;
          if (operand.kind === RulesV2.OperandKind.GlobalStateRef)
            return { type: StateValueType.Bool, value: true } as StateValue;
          return null;
        },
        resolvePrev(operand) {
          if (operand.kind === RulesV2.OperandKind.Literal) return operand.value;
          return null;
        },
        resolveSeries: () => EMPTY_SERIES,
      }),
    });
    const event: RulesV2.GlobalStateChangedEvent = {
      kind: RulesV2.EvaluationTriggerKind.GlobalStateChanged,
      ts: 1_000,
      profileId: 'profile-1',
      key: 'mood',
      prev: null,
      current: { type: StateValueType.Bool, value: true },
    };
    const fires = await dispatcher.dispatch(event, { watchedSymbolIds: ['AAPL'] });
    expect(fires.map((f) => f.ruleId)).toEqual(['reader']);
  });

  it('an IndicatorChanged event fires only rules whose condition references that instance + stateKey', async () => {
    const reading = rule({
      id: 'reader',
      condition: {
        kind: RulesV2.ConditionNodeKind.Leaf,
        leaf: {
          family: RulesV2.LeafConditionFamily.Comparison,
          operator: RulesV2.ComparisonOperator.Lt,
          left: {
            kind: RulesV2.OperandKind.IndicatorRef,
            instanceId: 'rsi-14',
            stateKey: 'value',
            valueType: StateValueType.Number,
          },
          right: {
            kind: RulesV2.OperandKind.Literal,
            value: { type: StateValueType.Number, value: 50 },
          },
        },
      },
    });
    const unrelated = rule({
      id: 'unrelated',
      condition: {
        kind: RulesV2.ConditionNodeKind.Leaf,
        leaf: {
          family: RulesV2.LeafConditionFamily.Comparison,
          operator: RulesV2.ComparisonOperator.Lt,
          left: {
            kind: RulesV2.OperandKind.IndicatorRef,
            instanceId: 'rsi-21',
            stateKey: 'value',
            valueType: StateValueType.Number,
          },
          right: {
            kind: RulesV2.OperandKind.Literal,
            value: { type: StateValueType.Number, value: 50 },
          },
        },
      },
    });
    const { dispatcher } = await setup({
      rules: [reading, unrelated],
      buildContext: () => ({
        symbolId: 'AAPL',
        resolveLatest(operand) {
          if (operand.kind === RulesV2.OperandKind.Literal) return operand.value;
          if (operand.kind === RulesV2.OperandKind.IndicatorRef)
            return { type: StateValueType.Number, value: 30 } as StateValue;
          return null;
        },
        resolvePrev(operand) {
          if (operand.kind === RulesV2.OperandKind.Literal) return operand.value;
          return null;
        },
        resolveSeries: () => EMPTY_SERIES,
      }),
    });
    const event: RulesV2.IndicatorChangedEvent = {
      kind: RulesV2.EvaluationTriggerKind.IndicatorChanged,
      ts: 1_000,
      symbolId: 'AAPL',
      instanceId: 'rsi-14',
      stateKey: 'value',
      prev: null,
      current: { type: StateValueType.Number, value: 30 },
    };
    const fires = await dispatcher.dispatch(event);
    expect(fires.map((f) => f.ruleId)).toEqual(['reader']);
  });
});
