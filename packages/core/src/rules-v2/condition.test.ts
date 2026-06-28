import { describe, expect, it } from 'vitest';

import { Period } from '../config.types.js';
import { StateValueType } from '../state.types.js';
import {
  type ConditionNode,
  ConditionNodeKind,
  type LeafCondition,
  LeafConditionFamily,
} from './condition.types.js';
import { OperandKind } from './operand.types.js';
import {
  ChannelOperator,
  ComparisonOperator,
  CrossingOperator,
  MovingOperator,
  StateOperator,
} from './operator.types.js';

describe('RulesV2 LeafCondition', () => {
  it('is a discriminated union by operator family — comparison carries (left, right) plus optional interval', () => {
    const leaf: LeafCondition = {
      family: LeafConditionFamily.Comparison,
      operator: ComparisonOperator.Gt,
      left: { kind: OperandKind.Price },
      right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 120 } },
    };
    expect(leaf).toEqual({
      family: LeafConditionFamily.Comparison,
      operator: ComparisonOperator.Gt,
      left: { kind: OperandKind.Price },
      right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 120 } },
    });
  });

  it('crossing family carries (left, right) and may carry an interval', () => {
    const leaf: LeafCondition = {
      family: LeafConditionFamily.Crossing,
      operator: CrossingOperator.CrossingUp,
      left: { kind: OperandKind.Price },
      right: {
        kind: OperandKind.IndicatorRef,
        instanceId: 'super-1',
        stateKey: 'upTrend',
        valueType: StateValueType.Number,
      },
      interval: Period.OneHour,
    };
    expect(leaf).toEqual({
      family: LeafConditionFamily.Crossing,
      operator: CrossingOperator.CrossingUp,
      left: { kind: OperandKind.Price },
      right: {
        kind: OperandKind.IndicatorRef,
        instanceId: 'super-1',
        stateKey: 'upTrend',
        valueType: StateValueType.Number,
      },
      interval: Period.OneHour,
    });
  });

  it('channel family carries (left, lower, upper)', () => {
    const leaf: LeafCondition = {
      family: LeafConditionFamily.Channel,
      operator: ChannelOperator.InsideChannel,
      left: { kind: OperandKind.Price },
      lower: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 100 } },
      upper: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 110 } },
    };
    expect(leaf).toEqual({
      family: LeafConditionFamily.Channel,
      operator: ChannelOperator.InsideChannel,
      left: { kind: OperandKind.Price },
      lower: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 100 } },
      upper: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 110 } },
    });
  });

  it('moving family carries (left, threshold, lookbackBars)', () => {
    const leaf: LeafCondition = {
      family: LeafConditionFamily.Moving,
      operator: MovingOperator.MovingUpPercent,
      left: {
        kind: OperandKind.IndicatorRef,
        instanceId: 'super-1',
        stateKey: 'upTrend',
        valueType: StateValueType.Number,
      },
      threshold: 10.5,
      lookbackBars: 2,
      interval: Period.OneHour,
    };
    expect(leaf).toEqual({
      family: LeafConditionFamily.Moving,
      operator: MovingOperator.MovingUpPercent,
      left: {
        kind: OperandKind.IndicatorRef,
        instanceId: 'super-1',
        stateKey: 'upTrend',
        valueType: StateValueType.Number,
      },
      threshold: 10.5,
      lookbackBars: 2,
      interval: Period.OneHour,
    });
  });

  it('state family carries (left, right)', () => {
    const leaf: LeafCondition = {
      family: LeafConditionFamily.State,
      operator: StateOperator.ChangesTo,
      left: {
        kind: OperandKind.IndicatorRef,
        instanceId: 'super-1',
        stateKey: 'buy',
        valueType: StateValueType.Bool,
      },
      right: { kind: OperandKind.Literal, value: { type: StateValueType.Bool, value: true } },
    };
    expect(leaf).toEqual({
      family: LeafConditionFamily.State,
      operator: StateOperator.ChangesTo,
      left: {
        kind: OperandKind.IndicatorRef,
        instanceId: 'super-1',
        stateKey: 'buy',
        valueType: StateValueType.Bool,
      },
      right: { kind: OperandKind.Literal, value: { type: StateValueType.Bool, value: true } },
    });
  });

  it('expresses bool-operand shortcut as Equals(operand, Literal(true)) — no IsTruthy operator', () => {
    const leaf: LeafCondition = {
      family: LeafConditionFamily.State,
      operator: StateOperator.Equals,
      left: {
        kind: OperandKind.IndicatorRef,
        instanceId: 'super-1',
        stateKey: 'buy',
        valueType: StateValueType.Bool,
      },
      right: { kind: OperandKind.Literal, value: { type: StateValueType.Bool, value: true } },
    };
    expect(leaf).toEqual({
      family: LeafConditionFamily.State,
      operator: StateOperator.Equals,
      left: {
        kind: OperandKind.IndicatorRef,
        instanceId: 'super-1',
        stateKey: 'buy',
        valueType: StateValueType.Bool,
      },
      right: { kind: OperandKind.Literal, value: { type: StateValueType.Bool, value: true } },
    });
  });
});

describe('RulesV2 ConditionNode', () => {
  it('composes And/Or groups around leaves', () => {
    const tree: ConditionNode = {
      kind: ConditionNodeKind.Or,
      children: [
        {
          kind: ConditionNodeKind.Leaf,
          leaf: {
            family: LeafConditionFamily.Comparison,
            operator: ComparisonOperator.Gt,
            left: { kind: OperandKind.Price },
            right: {
              kind: OperandKind.Literal,
              value: { type: StateValueType.Number, value: 120 },
            },
          },
        },
        {
          kind: ConditionNodeKind.And,
          children: [
            {
              kind: ConditionNodeKind.Leaf,
              leaf: {
                family: LeafConditionFamily.Comparison,
                operator: ComparisonOperator.Lt,
                left: { kind: OperandKind.Price },
                right: {
                  kind: OperandKind.Literal,
                  value: { type: StateValueType.Number, value: 100 },
                },
              },
            },
          ],
        },
      ],
    };
    expect(tree.kind).toBe(ConditionNodeKind.Or);
  });
});
