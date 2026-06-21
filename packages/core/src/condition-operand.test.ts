import { describe, expect, it } from 'vitest';

import { operandValueType } from './condition-operand.js';
import { type ConditionOperand, OperandKind } from './condition-operand.types.js';
import { StateValueType } from './state.types.js';

describe('ConditionOperand variants', () => {
  it('constructs CurrentValue with full payload', () => {
    const operand: ConditionOperand = {
      kind: OperandKind.CurrentValue,
      valueType: StateValueType.Number,
    };
    expect(operand).toEqual({ kind: OperandKind.CurrentValue, valueType: StateValueType.Number });
  });

  it('constructs OpenValue with full payload', () => {
    const operand: ConditionOperand = {
      kind: OperandKind.OpenValue,
      valueType: StateValueType.Number,
    };
    expect(operand).toEqual({ kind: OperandKind.OpenValue, valueType: StateValueType.Number });
  });

  it('constructs HighValue with full payload', () => {
    const operand: ConditionOperand = {
      kind: OperandKind.HighValue,
      valueType: StateValueType.Number,
    };
    expect(operand).toEqual({ kind: OperandKind.HighValue, valueType: StateValueType.Number });
  });

  it('constructs LowValue with full payload', () => {
    const operand: ConditionOperand = {
      kind: OperandKind.LowValue,
      valueType: StateValueType.Number,
    };
    expect(operand).toEqual({ kind: OperandKind.LowValue, valueType: StateValueType.Number });
  });

  it('constructs CloseValue with full payload', () => {
    const operand: ConditionOperand = {
      kind: OperandKind.CloseValue,
      valueType: StateValueType.Number,
    };
    expect(operand).toEqual({ kind: OperandKind.CloseValue, valueType: StateValueType.Number });
  });

  it('constructs VolumeValue with full payload', () => {
    const operand: ConditionOperand = {
      kind: OperandKind.VolumeValue,
      valueType: StateValueType.Number,
    };
    expect(operand).toEqual({ kind: OperandKind.VolumeValue, valueType: StateValueType.Number });
  });

  it('constructs IndicatorRef with full payload', () => {
    const operand: ConditionOperand = {
      kind: OperandKind.IndicatorRef,
      instanceId: 'sma-14',
      stateKey: 'value',
      valueType: StateValueType.Number,
    };
    expect(operand).toEqual({
      kind: OperandKind.IndicatorRef,
      instanceId: 'sma-14',
      stateKey: 'value',
      valueType: StateValueType.Number,
    });
  });

  it('constructs SymbolStateRef with full payload', () => {
    const operand: ConditionOperand = {
      kind: OperandKind.SymbolStateRef,
      key: 'trend',
      valueType: StateValueType.Enum,
    };
    expect(operand).toEqual({
      kind: OperandKind.SymbolStateRef,
      key: 'trend',
      valueType: StateValueType.Enum,
    });
  });

  it('constructs GlobalStateRef with full payload', () => {
    const operand: ConditionOperand = {
      kind: OperandKind.GlobalStateRef,
      key: 'regime',
      valueType: StateValueType.String,
    };
    expect(operand).toEqual({
      kind: OperandKind.GlobalStateRef,
      key: 'regime',
      valueType: StateValueType.String,
    });
  });

  it('constructs Literal with full payload', () => {
    const operand: ConditionOperand = {
      kind: OperandKind.Literal,
      value: { type: StateValueType.Number, value: 42 },
    };
    expect(operand).toEqual({
      kind: OperandKind.Literal,
      value: { type: StateValueType.Number, value: 42 },
    });
  });
});

describe('operandValueType', () => {
  it('reads valueType from non-literal operands', () => {
    expect(
      operandValueType({
        kind: OperandKind.IndicatorRef,
        instanceId: 'sma-14',
        stateKey: 'value',
        valueType: StateValueType.Number,
      }),
    ).toEqual(StateValueType.Number);
  });

  it('reads value.type from a Literal operand', () => {
    expect(
      operandValueType({
        kind: OperandKind.Literal,
        value: { type: StateValueType.Bool, value: true },
      }),
    ).toEqual(StateValueType.Bool);
  });
});
