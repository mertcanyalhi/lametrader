import {
  ActionKind,
  type BarClosedEvent,
  type BarOpenedEvent,
  ComparisonOperator,
  type ConditionNode,
  ConditionNodeKind,
  EvaluationTriggerKind,
  type GlobalStateChangedEvent,
  type IndicatorChangedEvent,
  LeafConditionFamily,
  NotificationChannel,
  OperandKind,
  Period,
  type Rule,
  type RuleEvent,
  RuleScopeKind,
  StateOperator,
  type StateValue,
  StateValueType,
  type SymbolStateChangedEvent,
  type TickEvent,
  type TimerEvent,
  TriggerKind,
} from '@lametrader/core';
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
      if (operand.kind === OperandKind.Price)
        return { type: StateValueType.Number, value: price } as StateValue;
      if (operand.kind === OperandKind.Literal) return operand.value;
      return null;
    },
    resolvePrev(operand) {
      if (operand.kind === OperandKind.Literal) return operand.value;
      return null;
    },
    resolveSeries() {
      return EMPTY_SERIES;
    },
  };
}

function priceGtLiteral(rhs: number): ConditionNode {
  return {
    kind: ConditionNodeKind.Leaf,
    leaf: {
      family: LeafConditionFamily.Comparison,
      operator: ComparisonOperator.Gt,
      left: { kind: OperandKind.Price },
      right: {
        kind: OperandKind.Literal,
        value: { type: StateValueType.Number, value: rhs },
      },
    },
  };
}

function rule(overrides: Partial<Rule>): Rule {
  return {
    id: 'r1',
    profileId: 'profile-1',
    name: 'Test rule',
    scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
    condition: priceGtLiteral(100),
    trigger: { kind: TriggerKind.EveryTime },
    expiration: null,
    actions: [
      {
        kind: ActionKind.Notification,
        channel: NotificationChannel.Telegram,
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
  rules: Rule[];
  /** Defaults to a price=120 context for every event. */
  buildContext?: (event: RuleEvent, firingSymbolId: string) => EvaluationContext;
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

const TICK_EVENT_AT = (ts: number, price = 120): TickEvent => ({
  kind: EvaluationTriggerKind.Tick,
  ts,
  symbolId: 'AAPL',
  price,
});

const BAR_OPENED = (ts: number, period: Period): BarOpenedEvent => ({
  kind: EvaluationTriggerKind.BarOpened,
  ts,
  symbolId: 'AAPL',
  period,
});

const BAR_CLOSED = (ts: number, period: Period): BarClosedEvent => ({
  kind: EvaluationTriggerKind.BarClosed,
  ts,
  symbolId: 'AAPL',
  period,
});

const TIMER_EVENT = (ts: number): TimerEvent => ({
  kind: EvaluationTriggerKind.Timer,
  ts,
});

describe('TriggerDispatcher — routing exclusivity', () => {
  it('a Tick event fires an EveryTime rule', async () => {
    const r = rule({ trigger: { kind: TriggerKind.EveryTime } });
    const { dispatcher } = await setup({ rules: [r] });
    const fires = await dispatcher.dispatch(TICK_EVENT_AT(1_000));
    expect(fires.map((f) => f.ruleId)).toEqual(['r1']);
  });

  it('a Tick event does NOT fire a OncePerBarOpen rule', async () => {
    const r = rule({
      trigger: { kind: TriggerKind.OncePerBarOpen, period: Period.OneMinute },
    });
    const { dispatcher } = await setup({ rules: [r] });
    const fires = await dispatcher.dispatch(TICK_EVENT_AT(1_000));
    expect(fires).toEqual([]);
  });

  it('a BarOpened event does NOT fire an EveryTime rule', async () => {
    const r = rule({ trigger: { kind: TriggerKind.EveryTime } });
    const { dispatcher } = await setup({ rules: [r] });
    const fires = await dispatcher.dispatch(BAR_OPENED(60_000, Period.OneMinute));
    expect(fires).toEqual([]);
  });
});

describe('TriggerDispatcher — bar-cadence triggers', () => {
  it('a BarOpened on matching period fires a OncePerBarOpen rule', async () => {
    const r = rule({
      trigger: { kind: TriggerKind.OncePerBarOpen, period: Period.OneMinute },
    });
    const { dispatcher } = await setup({ rules: [r] });
    const fires = await dispatcher.dispatch(BAR_OPENED(60_000, Period.OneMinute));
    expect(fires.map((f) => f.ruleId)).toEqual(['r1']);
  });

  it('a BarOpened on a different period does NOT fire a OncePerBarOpen rule', async () => {
    const r = rule({
      trigger: { kind: TriggerKind.OncePerBarOpen, period: Period.OneMinute },
    });
    const { dispatcher } = await setup({ rules: [r] });
    const fires = await dispatcher.dispatch(BAR_OPENED(60_000, Period.FiveMinutes));
    expect(fires).toEqual([]);
  });

  it('a BarClosed on matching period fires a OncePerBarClose rule', async () => {
    const r = rule({
      trigger: { kind: TriggerKind.OncePerBarClose, period: Period.OneMinute },
    });
    const { dispatcher } = await setup({ rules: [r] });
    const fires = await dispatcher.dispatch(BAR_CLOSED(60_000, Period.OneMinute));
    expect(fires.map((f) => f.ruleId)).toEqual(['r1']);
  });
});

describe('TriggerDispatcher — OncePerBar latch', () => {
  it('fires on the first matching tick within a bar', async () => {
    const r = rule({
      trigger: { kind: TriggerKind.OncePerBar, period: Period.OneMinute },
    });
    const { dispatcher } = await setup({ rules: [r] });
    const fires = await dispatcher.dispatch(TICK_EVENT_AT(1_000));
    expect(fires.map((f) => f.ruleId)).toEqual(['r1']);
  });

  it('suppresses a second matching tick within the same bar', async () => {
    const r = rule({
      trigger: { kind: TriggerKind.OncePerBar, period: Period.OneMinute },
    });
    const { dispatcher } = await setup({ rules: [r] });
    await dispatcher.dispatch(TICK_EVENT_AT(1_000));
    const fires = await dispatcher.dispatch(TICK_EVENT_AT(2_000));
    expect(fires).toEqual([]);
  });

  it('re-arms on the next BarOpened for the trigger period', async () => {
    const r = rule({
      trigger: { kind: TriggerKind.OncePerBar, period: Period.OneMinute },
    });
    const { dispatcher } = await setup({ rules: [r] });
    await dispatcher.dispatch(TICK_EVENT_AT(1_000));
    await dispatcher.dispatch(BAR_OPENED(60_000, Period.OneMinute));
    const fires = await dispatcher.dispatch(TICK_EVENT_AT(61_000));
    expect(fires.map((f) => f.ruleId)).toEqual(['r1']);
  });

  it('does NOT re-arm on a BarOpened for a different period', async () => {
    const r = rule({
      trigger: { kind: TriggerKind.OncePerBar, period: Period.OneMinute },
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
    const r = rule({ trigger: { kind: TriggerKind.Once } });
    const { repo, dispatcher } = await setup({ rules: [r] });
    await dispatcher.dispatch(TICK_EVENT_AT(1_000));
    const fetched = await repo.get('r1');
    expect(fetched?.enabled).toEqual(false);
  });

  it('does not fire again on the next matching tick (listEnabledForSymbol excludes it)', async () => {
    const r = rule({ trigger: { kind: TriggerKind.Once } });
    const { dispatcher } = await setup({ rules: [r] });
    await dispatcher.dispatch(TICK_EVENT_AT(1_000));
    const fires = await dispatcher.dispatch(TICK_EVENT_AT(2_000));
    expect(fires).toEqual([]);
  });
});

describe('TriggerDispatcher — condition gating', () => {
  it('does not fire when the condition is false', async () => {
    const r = rule({ trigger: { kind: TriggerKind.EveryTime } });
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
      trigger: { kind: TriggerKind.OncePerInterval, intervalMs: 60_000 },
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
      scope: { kind: RuleScopeKind.AllSymbols },
      trigger: { kind: TriggerKind.OncePerInterval, intervalMs: 60_000 },
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
    const reading: Rule = rule({
      id: 'reader',
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.State,
          operator: StateOperator.Equals,
          left: {
            kind: OperandKind.SymbolStateRef,
            key: 'mood',
            valueType: StateValueType.Bool,
          },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.Bool, value: true },
          },
        },
      },
    });
    const unrelated: Rule = rule({
      id: 'unrelated',
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.State,
          operator: StateOperator.Equals,
          left: {
            kind: OperandKind.SymbolStateRef,
            key: 'other',
            valueType: StateValueType.Bool,
          },
          right: {
            kind: OperandKind.Literal,
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
          if (operand.kind === OperandKind.Literal) return operand.value;
          if (operand.kind === OperandKind.SymbolStateRef && operand.key === 'mood')
            return { type: StateValueType.Bool, value: true } as StateValue;
          if (operand.kind === OperandKind.SymbolStateRef && operand.key === 'other')
            return { type: StateValueType.Bool, value: true } as StateValue;
          return null;
        },
        resolvePrev(operand) {
          if (operand.kind === OperandKind.Literal) return operand.value;
          return null;
        },
        resolveSeries: () => EMPTY_SERIES,
      }),
    });
    const event: SymbolStateChangedEvent = {
      kind: EvaluationTriggerKind.SymbolStateChanged,
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
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.State,
          operator: StateOperator.Equals,
          left: {
            kind: OperandKind.GlobalStateRef,
            key: 'mood',
            valueType: StateValueType.Bool,
          },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.Bool, value: true },
          },
        },
      },
    });
    const unrelated = rule({
      id: 'unrelated',
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.State,
          operator: StateOperator.Equals,
          left: {
            kind: OperandKind.GlobalStateRef,
            key: 'other',
            valueType: StateValueType.Bool,
          },
          right: {
            kind: OperandKind.Literal,
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
          if (operand.kind === OperandKind.Literal) return operand.value;
          if (operand.kind === OperandKind.GlobalStateRef)
            return { type: StateValueType.Bool, value: true } as StateValue;
          return null;
        },
        resolvePrev(operand) {
          if (operand.kind === OperandKind.Literal) return operand.value;
          return null;
        },
        resolveSeries: () => EMPTY_SERIES,
      }),
    });
    const event: GlobalStateChangedEvent = {
      kind: EvaluationTriggerKind.GlobalStateChanged,
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
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.Comparison,
          operator: ComparisonOperator.Lt,
          left: {
            kind: OperandKind.IndicatorRef,
            instanceId: 'rsi-14',
            stateKey: 'value',
            valueType: StateValueType.Number,
          },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.Number, value: 50 },
          },
        },
      },
    });
    const unrelated = rule({
      id: 'unrelated',
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.Comparison,
          operator: ComparisonOperator.Lt,
          left: {
            kind: OperandKind.IndicatorRef,
            instanceId: 'rsi-21',
            stateKey: 'value',
            valueType: StateValueType.Number,
          },
          right: {
            kind: OperandKind.Literal,
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
          if (operand.kind === OperandKind.Literal) return operand.value;
          if (operand.kind === OperandKind.IndicatorRef)
            return { type: StateValueType.Number, value: 30 } as StateValue;
          return null;
        },
        resolvePrev(operand) {
          if (operand.kind === OperandKind.Literal) return operand.value;
          return null;
        },
        resolveSeries: () => EMPTY_SERIES,
      }),
    });
    const event: IndicatorChangedEvent = {
      kind: EvaluationTriggerKind.IndicatorChanged,
      ts: 1_000,
      symbolId: 'AAPL',
      profileId: 'profile-1',
      instanceId: 'rsi-14',
      stateKey: 'value',
      prev: null,
      current: { type: StateValueType.Number, value: 30 },
    };
    const fires = await dispatcher.dispatch(event);
    expect(fires.map((f) => f.ruleId)).toEqual(['reader']);
  });

  it('an IndicatorChanged event fires only rules whose profileId matches the event profileId — different-profile rules stay asleep even when their condition references the same instance + stateKey', async () => {
    const sameProfile = rule({
      id: 'same-profile',
      profileId: 'profile-A',
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.Comparison,
          operator: ComparisonOperator.Lt,
          left: {
            kind: OperandKind.IndicatorRef,
            instanceId: 'rsi-14',
            stateKey: 'value',
            valueType: StateValueType.Number,
          },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.Number, value: 50 },
          },
        },
      },
    });
    const otherProfile = rule({
      id: 'other-profile',
      profileId: 'profile-B',
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.Comparison,
          operator: ComparisonOperator.Lt,
          left: {
            kind: OperandKind.IndicatorRef,
            instanceId: 'rsi-14',
            stateKey: 'value',
            valueType: StateValueType.Number,
          },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.Number, value: 50 },
          },
        },
      },
    });
    const { dispatcher } = await setup({
      rules: [sameProfile, otherProfile],
      buildContext: () => ({
        symbolId: 'AAPL',
        resolveLatest(operand) {
          if (operand.kind === OperandKind.Literal) return operand.value;
          if (operand.kind === OperandKind.IndicatorRef)
            return { type: StateValueType.Number, value: 30 } as StateValue;
          return null;
        },
        resolvePrev(operand) {
          if (operand.kind === OperandKind.Literal) return operand.value;
          return null;
        },
        resolveSeries: () => EMPTY_SERIES,
      }),
    });
    const event: IndicatorChangedEvent = {
      kind: EvaluationTriggerKind.IndicatorChanged,
      ts: 1_000,
      symbolId: 'AAPL',
      profileId: 'profile-A',
      instanceId: 'rsi-14',
      stateKey: 'value',
      prev: null,
      current: { type: StateValueType.Number, value: 30 },
    };
    const fires = await dispatcher.dispatch(event);
    expect(fires.map((f) => f.ruleId)).toEqual(['same-profile']);
  });
});

describe('TriggerDispatcher — buildContext receives the firing rule profileId', () => {
  it('passes rule.profileId as the third argument to buildContext for a symbol-bearing tick event', async () => {
    const r = rule({ id: 'r1', profileId: 'profile-7' });
    const seen: Array<{ symbolId: string; profileId: string }> = [];
    const { dispatcher } = await setup({
      rules: [r],
      buildContext: (_event, firingSymbolId, profileId) => {
        seen.push({ symbolId: firingSymbolId, profileId });
        return priceContext(120, firingSymbolId);
      },
    });
    await dispatcher.dispatch(TICK_EVENT_AT(1_000));
    expect(seen).toEqual([{ symbolId: 'AAPL', profileId: 'profile-7' }]);
  });

  it('passes rule.profileId on the symbol-less Timer fan-out path so AllSymbols cascades see the rule profile', async () => {
    const r = rule({
      id: 'r1',
      profileId: 'profile-9',
      scope: { kind: RuleScopeKind.AllSymbols },
      trigger: { kind: TriggerKind.OncePerInterval, intervalMs: 60_000 },
    });
    const seen: Array<{ symbolId: string; profileId: string }> = [];
    const { dispatcher } = await setup({
      rules: [r],
      buildContext: (_event, firingSymbolId, profileId) => {
        seen.push({ symbolId: firingSymbolId, profileId });
        return priceContext(120, firingSymbolId);
      },
    });
    await dispatcher.dispatch(TIMER_EVENT(60_000), { watchedSymbolIds: ['AAPL', 'MSFT'] });
    expect(seen).toEqual([
      { symbolId: 'AAPL', profileId: 'profile-9' },
      { symbolId: 'MSFT', profileId: 'profile-9' },
    ]);
  });
});
