import {
  ActionKind,
  type BarOpenedEvent,
  ComparisonOperator,
  ConditionNodeKind,
  EvaluationTriggerKind,
  LeafConditionFamily,
  NotificationChannel,
  OperandKind,
  Period,
  type Rule,
  type RuleEvent,
  RuleScopeKind,
  type StateValue,
  StateValueType,
  type TickEvent,
  type Trigger,
  TriggerKind,
} from '@lametrader/core';

import { InMemoryRuleRepository, TriggerDispatcher } from '@lametrader/engine';
import { describe, expect, it } from 'vitest';

import type { EvaluationContext } from '../../src/rules/evaluation-context.types.js';
import type { SeriesView } from '../../src/rules/series.types.js';

const EMPTY_SERIES: SeriesView = {
  length: 0,
  backwardWalk: () => [].values(),
  asOf: () => null,
};

/** Fake context that resolves Price to a per-event price + Literals to their value. */
function buildContextFor(priceByTs: ReadonlyMap<number, number>) {
  return (event: RuleEvent): EvaluationContext => {
    const price = priceByTs.get(event.ts);
    return {
      symbolId: 'AAPL',
      resolveLatest(operand) {
        if (operand.kind === OperandKind.Price)
          return price !== undefined
            ? ({ type: StateValueType.Number, value: price } as StateValue)
            : null;
        if (operand.kind === OperandKind.Literal) return operand.value;
        return null;
      },
      resolvePrev(operand) {
        if (operand.kind === OperandKind.Literal) return operand.value;
        return null;
      },
      resolveSeries: () => EMPTY_SERIES,
    };
  };
}

function priceGtRule(id: string, trigger: Trigger, threshold = 100): Rule {
  return {
    id,
    profileId: 'profile-1',
    name: id,
    scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
    condition: {
      kind: ConditionNodeKind.Leaf,
      leaf: {
        family: LeafConditionFamily.Comparison,
        operator: ComparisonOperator.Gt,
        left: { kind: OperandKind.Price },
        right: {
          kind: OperandKind.Literal,
          value: { type: StateValueType.Number, value: threshold },
        },
      },
    },
    trigger,
    expiration: null,
    actions: [
      {
        kind: ActionKind.Notification,
        channel: NotificationChannel.Telegram,
        destinationName: 'main',
        template: id,
      },
    ],
    enabled: true,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

const tick = (ts: number): TickEvent => ({
  kind: EvaluationTriggerKind.Tick,
  ts,
  symbolId: 'AAPL',
  price: 120,
});

const barOpened = (ts: number, period: Period): BarOpenedEvent => ({
  kind: EvaluationTriggerKind.BarOpened,
  ts,
  symbolId: 'AAPL',
  period,
});

describe('rules trigger dispatcher (e2e)', () => {
  it('routes ticks + bar events through the dispatch chain end-to-end — EveryTime fires every tick, OncePerBar once per bar with re-arm, Once auto-disables', async () => {
    const repo = new InMemoryRuleRepository();
    await repo.save(priceGtRule('every-time', { kind: TriggerKind.EveryTime }));
    await repo.save(
      priceGtRule('once-per-bar', {
        kind: TriggerKind.OncePerBar,
        period: Period.OneMinute,
      }),
    );
    await repo.save(priceGtRule('once', { kind: TriggerKind.Once }));

    const dispatcher = new TriggerDispatcher({
      rules: repo,
      buildContext: buildContextFor(
        new Map([
          [1_000, 120],
          [2_000, 121],
          [61_000, 122],
        ]),
      ),
    });

    // Two ticks within the first 1m bar.
    const fires1 = await dispatcher.dispatch(tick(1_000));
    const fires2 = await dispatcher.dispatch(tick(2_000));
    // BarOpened re-arms OncePerBar; tick in the new bar fires it again.
    const fires3 = await dispatcher.dispatch(barOpened(60_000, Period.OneMinute));
    const fires4 = await dispatcher.dispatch(tick(61_000));

    const flatten = (rs: typeof fires1) => rs.map((r) => r.ruleId).sort();

    // Tick 1: every-time + once-per-bar + once all fire.
    expect(flatten(fires1)).toEqual(['every-time', 'once', 'once-per-bar']);
    // Tick 2: every-time only — once-per-bar latched, once auto-disabled.
    expect(flatten(fires2)).toEqual(['every-time']);
    // BarOpened — doesn't itself fire any tick-triggered rule.
    expect(flatten(fires3)).toEqual([]);
    // Tick 4 in new bar: every-time + once-per-bar (re-armed). once stays off.
    expect(flatten(fires4)).toEqual(['every-time', 'once-per-bar']);

    // Once rule auto-disabled in the repo.
    const once = await repo.get('once');
    expect(once?.enabled).toEqual(false);
  });

  it('returns an empty fire list (no crash) on a Tick event when no enabled rules match', async () => {
    const repo = new InMemoryRuleRepository();
    const dispatcher = new TriggerDispatcher({
      rules: repo,
      buildContext: buildContextFor(new Map([[1_000, 120]])),
    });
    const fires = await dispatcher.dispatch(tick(1_000));
    expect(fires).toEqual([]);
  });
});
