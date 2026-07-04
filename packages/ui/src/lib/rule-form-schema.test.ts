import {
  ComparisonOperator,
  ConditionNodeKind,
  LeafConditionFamily,
  OperandKind,
  StateValueType,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { isConditionTreeNonEmpty, OperandValueKind, operandValueKind } from './rule-form-schema';

describe('operandValueKind', () => {
  it('resolves Price to Numeric', () => {
    expect(operandValueKind({ kind: OperandKind.Price })).toEqual(OperandValueKind.Numeric);
  });

  it('resolves OHLCV operands to Numeric', () => {
    expect(operandValueKind({ kind: OperandKind.Open })).toEqual(OperandValueKind.Numeric);
    expect(operandValueKind({ kind: OperandKind.High })).toEqual(OperandValueKind.Numeric);
    expect(operandValueKind({ kind: OperandKind.Low })).toEqual(OperandValueKind.Numeric);
    expect(operandValueKind({ kind: OperandKind.Close })).toEqual(OperandValueKind.Numeric);
    expect(operandValueKind({ kind: OperandKind.Volume })).toEqual(OperandValueKind.Numeric);
  });

  it("reads an IndicatorRef's valueType", () => {
    expect(
      operandValueKind({
        kind: OperandKind.IndicatorRef,
        instanceId: 'i1',
        stateKey: 'signal',
        valueType: StateValueType.Bool,
      }),
    ).toEqual(OperandValueKind.Bool);
  });

  it("reads a Literal's value.type", () => {
    expect(
      operandValueKind({
        kind: OperandKind.Literal,
        value: { type: StateValueType.String, value: 'hi' },
      }),
    ).toEqual(OperandValueKind.StringLike);
  });
});

describe('isConditionTreeNonEmpty', () => {
  it('returns true for a leaf node', () => {
    expect(
      isConditionTreeNonEmpty({
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.Comparison,
          operator: ComparisonOperator.Gt,
          left: { kind: OperandKind.Price },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.Number, value: 0 },
          },
        },
      }),
    ).toEqual(true);
  });

  it('returns false for an empty group', () => {
    expect(
      isConditionTreeNonEmpty({
        kind: ConditionNodeKind.And,
        children: [],
      }),
    ).toEqual(false);
  });

  it('returns false when a nested group is empty', () => {
    expect(
      isConditionTreeNonEmpty({
        kind: ConditionNodeKind.And,
        children: [
          {
            kind: ConditionNodeKind.Or,
            children: [],
          },
        ],
      }),
    ).toEqual(false);
  });
});
