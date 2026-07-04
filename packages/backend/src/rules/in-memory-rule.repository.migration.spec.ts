import {
  ActionKind,
  ComparisonOperator,
  ConditionNodeKind,
  LeafConditionFamily,
  NotificationChannel,
  OperandKind,
  type Rule,
  RuleScopeKind,
  StateOperator,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';

import { InMemoryRuleRepository } from './in-memory-rule.repository.js';

/**
 * Build a minimal-valid rule with the given condition tree.
 */
function rule(condition: Rule['condition'], overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'r',
    profileId: 'p',
    name: 'r',
    scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
    condition,
    trigger: { kind: TriggerKind.EveryTime },
    expiration: null,
    actions: [
      {
        kind: ActionKind.Notification,
        channel: NotificationChannel.Telegram,
        destinationName: 'main',
        template: 'fired',
      },
    ],
    enabled: true,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('InMemoryRuleRepository — legacy state/Equals migration', () => {
  it('rewrites a stored state/Equals leaf with a non-state-ref LHS to comparison/Eq on read via get', async () => {
    const repo = new InMemoryRuleRepository();
    await repo.save(
      rule({
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.State,
          operator: StateOperator.Equals,
          left: { kind: OperandKind.Price },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.Number, value: 100 },
          },
        },
      }),
    );
    const got = await repo.get('r');
    expect(got?.condition).toEqual({
      kind: ConditionNodeKind.Leaf,
      leaf: {
        family: LeafConditionFamily.Comparison,
        operator: ComparisonOperator.Eq,
        left: { kind: OperandKind.Price },
        right: {
          kind: OperandKind.Literal,
          value: { type: StateValueType.Number, value: 100 },
        },
      },
    });
  });

  it('rewrites a stored state/Equals leaf with a non-state-ref LHS to comparison/Eq on read via list', async () => {
    const repo = new InMemoryRuleRepository();
    await repo.save(
      rule({
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.State,
          operator: StateOperator.NotEquals,
          left: { kind: OperandKind.Close },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.Number, value: 50 },
          },
        },
      }),
    );
    const [got] = await repo.list();
    expect(got?.condition).toEqual({
      kind: ConditionNodeKind.Leaf,
      leaf: {
        family: LeafConditionFamily.Comparison,
        operator: ComparisonOperator.Neq,
        left: { kind: OperandKind.Close },
        right: {
          kind: OperandKind.Literal,
          value: { type: StateValueType.Number, value: 50 },
        },
      },
    });
  });

  it('rewrites a stored state/Equals leaf with a non-state-ref LHS to comparison/Eq on read via listForSymbol', async () => {
    const repo = new InMemoryRuleRepository();
    await repo.save(
      rule({
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.State,
          operator: StateOperator.Equals,
          left: { kind: OperandKind.Price },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.Number, value: 100 },
          },
        },
      }),
    );
    const [got] = await repo.listForSymbol('AAPL');
    expect(got?.condition).toEqual({
      kind: ConditionNodeKind.Leaf,
      leaf: {
        family: LeafConditionFamily.Comparison,
        operator: ComparisonOperator.Eq,
        left: { kind: OperandKind.Price },
        right: {
          kind: OperandKind.Literal,
          value: { type: StateValueType.Number, value: 100 },
        },
      },
    });
  });

  it('preserves a stored state/Equals leaf with a SymbolStateRef LHS unchanged on read', async () => {
    const repo = new InMemoryRuleRepository();
    const stored = rule({
      kind: ConditionNodeKind.Leaf,
      leaf: {
        family: LeafConditionFamily.State,
        operator: StateOperator.Equals,
        left: {
          kind: OperandKind.SymbolStateRef,
          key: 'trend',
          valueType: StateValueType.String,
        },
        right: {
          kind: OperandKind.Literal,
          value: { type: StateValueType.String, value: 'up' },
        },
      },
    });
    await repo.save(stored);
    const got = await repo.get('r');
    expect(got).toEqual(stored);
  });
});
