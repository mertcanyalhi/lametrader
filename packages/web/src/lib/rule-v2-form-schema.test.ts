import { RulesV2, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import {
  isBoolOperand,
  isConditionTreeV2NonEmpty,
  OperandValueKind,
  operandValueKind,
} from './rule-v2-form-schema';

describe('operandValueKind', () => {
  it('resolves Price to Numeric', () => {
    expect(operandValueKind({ kind: RulesV2.OperandKind.Price })).toEqual(OperandValueKind.Numeric);
  });

  it('resolves OHLCV operands to Numeric', () => {
    expect(operandValueKind({ kind: RulesV2.OperandKind.Open })).toEqual(OperandValueKind.Numeric);
    expect(operandValueKind({ kind: RulesV2.OperandKind.High })).toEqual(OperandValueKind.Numeric);
    expect(operandValueKind({ kind: RulesV2.OperandKind.Low })).toEqual(OperandValueKind.Numeric);
    expect(operandValueKind({ kind: RulesV2.OperandKind.Close })).toEqual(OperandValueKind.Numeric);
    expect(operandValueKind({ kind: RulesV2.OperandKind.Volume })).toEqual(
      OperandValueKind.Numeric,
    );
  });

  it("reads an IndicatorRef's valueType", () => {
    expect(
      operandValueKind({
        kind: RulesV2.OperandKind.IndicatorRef,
        instanceId: 'i1',
        stateKey: 'signal',
        valueType: StateValueType.Bool,
      }),
    ).toEqual(OperandValueKind.Bool);
  });

  it("reads a Literal's value.type", () => {
    expect(
      operandValueKind({
        kind: RulesV2.OperandKind.Literal,
        value: { type: StateValueType.String, value: 'hi' },
      }),
    ).toEqual(OperandValueKind.StringLike);
  });
});

describe('isBoolOperand', () => {
  it('returns true for a Bool-typed indicator-ref', () => {
    expect(
      isBoolOperand({
        kind: RulesV2.OperandKind.IndicatorRef,
        instanceId: 'i1',
        stateKey: 'signal',
        valueType: StateValueType.Bool,
      }),
    ).toEqual(true);
  });

  it('returns false for a Number indicator-ref', () => {
    expect(
      isBoolOperand({
        kind: RulesV2.OperandKind.IndicatorRef,
        instanceId: 'i1',
        stateKey: 'value',
        valueType: StateValueType.Number,
      }),
    ).toEqual(false);
  });

  it('returns false for a Literal (which carries its own value)', () => {
    expect(
      isBoolOperand({
        kind: RulesV2.OperandKind.Literal,
        value: { type: StateValueType.Bool, value: true },
      }),
    ).toEqual(false);
  });
});

describe('isConditionTreeV2NonEmpty', () => {
  it('returns true for a leaf node', () => {
    expect(
      isConditionTreeV2NonEmpty({
        kind: RulesV2.ConditionNodeKind.Leaf,
        leaf: {
          family: RulesV2.LeafConditionFamily.Comparison,
          operator: RulesV2.ComparisonOperator.Gt,
          left: { kind: RulesV2.OperandKind.Price },
          right: {
            kind: RulesV2.OperandKind.Literal,
            value: { type: StateValueType.Number, value: 0 },
          },
        },
      }),
    ).toEqual(true);
  });

  it('returns false for an empty group', () => {
    expect(
      isConditionTreeV2NonEmpty({
        kind: RulesV2.ConditionNodeKind.And,
        children: [],
      }),
    ).toEqual(false);
  });

  it('returns false when a nested group is empty', () => {
    expect(
      isConditionTreeV2NonEmpty({
        kind: RulesV2.ConditionNodeKind.And,
        children: [
          {
            kind: RulesV2.ConditionNodeKind.Or,
            children: [],
          },
        ],
      }),
    ).toEqual(false);
  });
});
