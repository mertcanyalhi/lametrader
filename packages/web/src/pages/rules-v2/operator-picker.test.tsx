// @vitest-environment jsdom
import { RulesV2, StateValueType } from '@lametrader/core';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { familyForOperatorV2, validOperatorsV2For } from './operator-picker';

describe('validOperatorsV2For', () => {
  afterEach(() => cleanup());

  it('returns every Comparison, Crossing, Channel, Moving, and State operator when both operands are Number', () => {
    expect(validOperatorsV2For(StateValueType.Number, StateValueType.Number)).toEqual([
      ...Object.values(RulesV2.ComparisonOperator),
      ...Object.values(RulesV2.CrossingOperator),
      ...Object.values(RulesV2.ChannelOperator),
      ...Object.values(RulesV2.MovingOperator),
      ...Object.values(RulesV2.StateOperator),
    ]);
  });

  it('returns only the State operators when both operands are Bool (so the picker collapses to the bool-shortcut UI per CONTEXT.md Ex.3)', () => {
    expect(validOperatorsV2For(StateValueType.Bool, StateValueType.Bool)).toEqual(
      Object.values(RulesV2.StateOperator),
    );
  });

  it('returns only the State operators when both operands are String (numeric operators rejected on non-numeric pairs)', () => {
    expect(validOperatorsV2For(StateValueType.String, StateValueType.String)).toEqual(
      Object.values(RulesV2.StateOperator),
    );
  });

  it('returns no operators when the right operand type does not match the left (a numeric vs string pair has no legal operator under the v2 boundary)', () => {
    expect(validOperatorsV2For(StateValueType.Number, StateValueType.String)).toEqual([]);
  });

  it('returns every Comparison / Crossing / Channel / Moving / State operator when there is no right operand (Moving family — the operator is the only signal of the leaf shape)', () => {
    expect(validOperatorsV2For(StateValueType.Number, undefined)).toEqual([
      ...Object.values(RulesV2.ComparisonOperator),
      ...Object.values(RulesV2.CrossingOperator),
      ...Object.values(RulesV2.ChannelOperator),
      ...Object.values(RulesV2.MovingOperator),
      ...Object.values(RulesV2.StateOperator),
    ]);
  });
});

describe('familyForOperatorV2', () => {
  afterEach(() => cleanup());

  it('returns Comparison for ComparisonOperator.Gt', () => {
    expect(familyForOperatorV2(RulesV2.ComparisonOperator.Gt)).toEqual(
      RulesV2.LeafConditionFamily.Comparison,
    );
  });

  it('returns Crossing for CrossingOperator.CrossingUp', () => {
    expect(familyForOperatorV2(RulesV2.CrossingOperator.CrossingUp)).toEqual(
      RulesV2.LeafConditionFamily.Crossing,
    );
  });

  it('returns Channel for ChannelOperator.InsideChannel', () => {
    expect(familyForOperatorV2(RulesV2.ChannelOperator.InsideChannel)).toEqual(
      RulesV2.LeafConditionFamily.Channel,
    );
  });

  it('returns Moving for MovingOperator.MovingUpPercent', () => {
    expect(familyForOperatorV2(RulesV2.MovingOperator.MovingUpPercent)).toEqual(
      RulesV2.LeafConditionFamily.Moving,
    );
  });

  it('returns State for StateOperator.ChangesTo', () => {
    expect(familyForOperatorV2(RulesV2.StateOperator.ChangesTo)).toEqual(
      RulesV2.LeafConditionFamily.State,
    );
  });
});
