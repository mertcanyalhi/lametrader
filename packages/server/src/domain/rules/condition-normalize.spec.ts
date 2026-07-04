import {
  ActionKind,
  ComparisonOperator,
  type ConditionNode,
  ConditionNodeKind,
  LeafConditionFamily,
  NotificationChannel,
  OperandKind,
  Period,
  type Rule,
  RuleScopeKind,
  StateOperator,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';
import { normalizeRule } from './condition-normalize.js';

/**
 * Build a minimal-valid rule whose condition tree can be swapped in for the
 * specific shape under test.
 */
function ruleWith(condition: ConditionNode, overrides: Partial<Rule> = {}): Rule {
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

describe('normalizeRule', () => {
  it('rewrites a state/Equals leaf with a non-state-ref LHS (Price) to comparison/Eq, preserving the rest of the leaf', () => {
    const before: ConditionNode = {
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
    };
    const after = normalizeRule(ruleWith(before)).condition;
    expect(after).toEqual({
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

  it('rewrites a state/NotEquals leaf with a non-state-ref LHS (Close) to comparison/Neq, carrying interval through', () => {
    const before: ConditionNode = {
      kind: ConditionNodeKind.Leaf,
      leaf: {
        family: LeafConditionFamily.State,
        operator: StateOperator.NotEquals,
        interval: Period.OneMinute,
        left: { kind: OperandKind.Close },
        right: {
          kind: OperandKind.Literal,
          value: { type: StateValueType.Number, value: 50 },
        },
      },
    };
    const after = normalizeRule(ruleWith(before)).condition;
    expect(after).toEqual({
      kind: ConditionNodeKind.Leaf,
      leaf: {
        family: LeafConditionFamily.Comparison,
        operator: ComparisonOperator.Neq,
        interval: Period.OneMinute,
        left: { kind: OperandKind.Close },
        right: {
          kind: OperandKind.Literal,
          value: { type: StateValueType.Number, value: 50 },
        },
      },
    });
  });

  it('keeps a state/Equals leaf with a SymbolStateRef LHS untouched (state-ref dispatch preserves NULL-aware semantics)', () => {
    const before: ConditionNode = {
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
    };
    expect(normalizeRule(ruleWith(before)).condition).toEqual(before);
  });

  it('keeps a state/Equals leaf with a GlobalStateRef LHS untouched', () => {
    const before: ConditionNode = {
      kind: ConditionNodeKind.Leaf,
      leaf: {
        family: LeafConditionFamily.State,
        operator: StateOperator.Equals,
        left: {
          kind: OperandKind.GlobalStateRef,
          key: 'regime',
          valueType: StateValueType.String,
        },
        right: {
          kind: OperandKind.Literal,
          value: { type: StateValueType.String, value: 'bull' },
        },
      },
    };
    expect(normalizeRule(ruleWith(before)).condition).toEqual(before);
  });

  it('keeps a state/ChangesTo leaf untouched (only Equals/NotEquals collapse)', () => {
    const before: ConditionNode = {
      kind: ConditionNodeKind.Leaf,
      leaf: {
        family: LeafConditionFamily.State,
        operator: StateOperator.ChangesTo,
        left: { kind: OperandKind.Price },
        right: {
          kind: OperandKind.Literal,
          value: { type: StateValueType.Number, value: 100 },
        },
      },
    };
    expect(normalizeRule(ruleWith(before)).condition).toEqual(before);
  });

  it('walks every And/Or group and rewrites nested leaves', () => {
    const before: ConditionNode = {
      kind: ConditionNodeKind.And,
      children: [
        {
          kind: ConditionNodeKind.Or,
          children: [
            {
              kind: ConditionNodeKind.Leaf,
              leaf: {
                family: LeafConditionFamily.State,
                operator: StateOperator.Equals,
                left: { kind: OperandKind.Price },
                right: {
                  kind: OperandKind.Literal,
                  value: { type: StateValueType.Number, value: 1 },
                },
              },
            },
            {
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
            },
          ],
        },
      ],
    };
    const after = normalizeRule(ruleWith(before)).condition;
    expect(after).toEqual({
      kind: ConditionNodeKind.And,
      children: [
        {
          kind: ConditionNodeKind.Or,
          children: [
            {
              kind: ConditionNodeKind.Leaf,
              leaf: {
                family: LeafConditionFamily.Comparison,
                operator: ComparisonOperator.Eq,
                left: { kind: OperandKind.Price },
                right: {
                  kind: OperandKind.Literal,
                  value: { type: StateValueType.Number, value: 1 },
                },
              },
            },
            {
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
            },
          ],
        },
      ],
    });
  });

  it('returns the same rule reference when no leaf needs rewriting (identity-preserving for the hot path)', () => {
    const rule = ruleWith({
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
    });
    expect(normalizeRule(rule)).toBe(rule);
  });
});
