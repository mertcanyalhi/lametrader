import { describe, expect, it } from 'vitest';

import { StateValueType } from '../state.types.js';
import { type ConditionOperand, OperandKind } from './operand.types.js';

describe('RulesV2 ConditionOperand', () => {
  it('exposes the ten kinds covering price/OHLCV/indicator/state/literal — with Price replacing v1 CurrentValue', () => {
    const operands: ConditionOperand[] = [
      { kind: OperandKind.Price },
      { kind: OperandKind.Open },
      { kind: OperandKind.High },
      { kind: OperandKind.Low },
      { kind: OperandKind.Close },
      { kind: OperandKind.Volume },
      {
        kind: OperandKind.IndicatorRef,
        instanceId: 'i1',
        stateKey: 'value',
        valueType: StateValueType.Number,
      },
      { kind: OperandKind.SymbolStateRef, key: 'trend', valueType: StateValueType.String },
      { kind: OperandKind.GlobalStateRef, key: 'mode', valueType: StateValueType.String },
      { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 120 } },
    ];
    expect(operands.map((o) => o.kind)).toEqual([
      OperandKind.Price,
      OperandKind.Open,
      OperandKind.High,
      OperandKind.Low,
      OperandKind.Close,
      OperandKind.Volume,
      OperandKind.IndicatorRef,
      OperandKind.SymbolStateRef,
      OperandKind.GlobalStateRef,
      OperandKind.Literal,
    ]);
    expect(OperandKind.Price).toBe('price');
  });
});
