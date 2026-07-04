import {
  ActionKind,
  ComparisonOperator,
  type ConditionNode,
  ConditionNodeKind,
  EvaluationTriggerKind,
  LeafConditionFamily,
  NotificationChannel,
  OperandKind,
  type Rule,
  type RuleEvent,
  RuleScopeKind,
  type StateValue,
  StateValueType,
  type TickEvent,
  TriggerKind,
} from '@lametrader/core';

import { _resetLogRoot, _resetLogScopes } from '../engine-log.js';
import type { EvaluationContext } from '../evaluation-context.types.js';
import { InMemoryRuleRepository } from '../in-memory-rule.repository.js';
import type { SeriesView } from '../series.types.js';
import { TriggerDispatcher } from './dispatcher.js';

const EMPTY_SERIES: SeriesView = {
  length: 0,
  backwardWalk: () => [].values(),
  asOf: () => null,
};

/** Trivial context that returns `price` for Price and literal-echo for Literal. */
function priceContext(price: number): EvaluationContext {
  return {
    symbolId: 'AAPL',
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
    resolveSeries: () => EMPTY_SERIES,
  };
}

const PRICE_GT_100: ConditionNode = {
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
};

function rule(overrides: Partial<Rule> & Pick<Rule, 'id'>): Rule {
  return {
    profileId: 'profile-1',
    name: 'Test',
    scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
    condition: PRICE_GT_100,
    trigger: { kind: TriggerKind.EveryTime },
    expiration: null,
    actions: [
      {
        kind: ActionKind.Notification,
        channel: NotificationChannel.Telegram,
        destinationName: 'main',
        template: 'fire',
      },
    ],
    enabled: true,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const TICK: TickEvent = {
  kind: EvaluationTriggerKind.Tick,
  ts: 1_000,
  symbolId: 'AAPL',
  price: 120,
};

function parseRecord(line: string): Record<string, unknown> {
  return JSON.parse(line);
}

/**
 * Filter captured records down to the dispatcher's own scope so the leaf
 * trace from `engine.rules.operators` (also enabled by `engine.rules.*`)
 * doesn't pollute the assertion.
 */
function dispatcherRecords(records: Record<string, unknown>[]): Record<string, unknown>[] {
  return records.filter((r) => r.scope === 'engine.rules.dispatch');
}

describe('TriggerDispatcher trace', () => {
  afterEach(() => {
    _resetLogRoot();
    _resetLogScopes([]);
  });

  it('emits a dispatcher_decision trace per inbound event carrying candidates / eligible / dropped', async () => {
    const records: Record<string, unknown>[] = [];
    _resetLogRoot({
      write: (line) => {
        records.push(parseRecord(line));
      },
    });
    _resetLogScopes([{ pattern: 'engine.rules.dispatch', level: 'trace' }]);
    const repo = new InMemoryRuleRepository();
    // Two rules: r1 fires (price 120 > 100), r2 drops on condition (price 120 not > 200).
    await repo.save(rule({ id: 'r1', order: 0 }));
    await repo.save(
      rule({
        id: 'r2',
        order: 1,
        condition: {
          kind: ConditionNodeKind.Leaf,
          leaf: {
            family: LeafConditionFamily.Comparison,
            operator: ComparisonOperator.Gt,
            left: { kind: OperandKind.Price },
            right: {
              kind: OperandKind.Literal,
              value: { type: StateValueType.Number, value: 200 },
            },
          },
        },
      }),
    );
    const dispatcher = new TriggerDispatcher({
      rules: repo,
      buildContext: () => priceContext(120),
    });

    await dispatcher.dispatch(TICK as RuleEvent);

    expect(dispatcherRecords(records)).toEqual([
      {
        level: 10,
        time: expect.any(Number),
        app: 'engine',
        scope: 'engine.rules.dispatch',
        eventKind: EvaluationTriggerKind.Tick,
        eventTs: 1_000,
        candidates: ['r1', 'r2'],
        eligible: ['r1'],
        dropped: [{ ruleId: 'r2', reason: 'condition-false' }],
        msg: 'dispatcher_decision',
      },
    ]);
  });
});
