// @vitest-environment jsdom
import { RulesV2, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { OperandValueKind } from '../../lib/rule-v2-form-schema';
import { legalFamiliesFor, legalOperatorsFor } from './operator-picker-v2';

describe('legalFamiliesFor', () => {
  it('lists every family for a Numeric LHS', () => {
    expect(Array.from(legalFamiliesFor(OperandValueKind.Numeric))).toEqual([
      RulesV2.LeafConditionFamily.Comparison,
      RulesV2.LeafConditionFamily.Crossing,
      RulesV2.LeafConditionFamily.Channel,
      RulesV2.LeafConditionFamily.Moving,
      RulesV2.LeafConditionFamily.State,
    ]);
  });

  it('narrows to the State family for a Bool LHS', () => {
    expect(Array.from(legalFamiliesFor(OperandValueKind.Bool))).toEqual([
      RulesV2.LeafConditionFamily.State,
    ]);
  });

  it('narrows to the State family for a string-like LHS', () => {
    expect(Array.from(legalFamiliesFor(OperandValueKind.StringLike))).toEqual([
      RulesV2.LeafConditionFamily.State,
    ]);
  });
});

describe('legalOperatorsFor', () => {
  it('exposes Crossing operators when the LHS is Price (numeric)', () => {
    const options = legalOperatorsFor({ kind: RulesV2.OperandKind.Price }).map((o) => o.value);
    expect(options.includes(RulesV2.CrossingOperator.Crossing)).toEqual(true);
  });

  it('hides Crossing operators when the LHS is a Bool indicator-ref', () => {
    const options = legalOperatorsFor({
      kind: RulesV2.OperandKind.IndicatorRef,
      instanceId: 'sup-1',
      stateKey: 'superTrendBuy',
      valueType: StateValueType.Bool,
    }).map((o) => o.value);
    expect(options.includes(RulesV2.CrossingOperator.Crossing)).toEqual(false);
    expect(options.includes(RulesV2.StateOperator.Equals)).toEqual(true);
  });
});
