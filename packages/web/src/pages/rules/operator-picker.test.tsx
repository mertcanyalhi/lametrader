// @vitest-environment jsdom
import {
  CrossingOperator,
  LeafConditionFamily,
  OperandKind,
  StateOperator,
  StateValueType,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { OperandValueKind } from '../../lib/rule-form-schema';
import { legalFamiliesFor, legalOperatorsFor } from './operator-picker';

describe('legalFamiliesFor', () => {
  it('lists every family for a Numeric LHS', () => {
    expect(Array.from(legalFamiliesFor(OperandValueKind.Numeric))).toEqual([
      LeafConditionFamily.Comparison,
      LeafConditionFamily.Crossing,
      LeafConditionFamily.Channel,
      LeafConditionFamily.Moving,
      LeafConditionFamily.State,
    ]);
  });

  it('narrows to the State family for a Bool LHS', () => {
    expect(Array.from(legalFamiliesFor(OperandValueKind.Bool))).toEqual([
      LeafConditionFamily.State,
    ]);
  });

  it('narrows to the State family for a string-like LHS', () => {
    expect(Array.from(legalFamiliesFor(OperandValueKind.StringLike))).toEqual([
      LeafConditionFamily.State,
    ]);
  });
});

describe('legalOperatorsFor', () => {
  it('exposes Crossing operators when the LHS is Price (numeric)', () => {
    const options = legalOperatorsFor({ kind: OperandKind.Price }).map((o) => o.value);
    expect(options.includes(CrossingOperator.Crossing)).toEqual(true);
  });

  it('hides Crossing operators when the LHS is a Bool indicator-ref', () => {
    const options = legalOperatorsFor({
      kind: OperandKind.IndicatorRef,
      instanceId: 'sup-1',
      stateKey: 'superTrendBuy',
      valueType: StateValueType.Bool,
    }).map((o) => o.value);
    expect(options.includes(CrossingOperator.Crossing)).toEqual(false);
    expect(options.includes(StateOperator.Equals)).toEqual(true);
  });
});
