import { NumericOperator, type StateValue, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { type ComparisonOperator, evaluateComparison } from './comparison-evaluator.js';

const num = (value: number): StateValue => ({ type: StateValueType.Number, value });

/** Table of (operator, left, right, expected) covering true/false/equal per operator. */
const cases: { operator: ComparisonOperator; left: number; right: number; expected: boolean }[] = [
  { operator: NumericOperator.Gt, left: 2, right: 1, expected: true },
  { operator: NumericOperator.Gt, left: 1, right: 2, expected: false },
  { operator: NumericOperator.Gt, left: 1, right: 1, expected: false },
  { operator: NumericOperator.Lt, left: 1, right: 2, expected: true },
  { operator: NumericOperator.Lt, left: 2, right: 1, expected: false },
  { operator: NumericOperator.Lt, left: 1, right: 1, expected: false },
  { operator: NumericOperator.Gte, left: 2, right: 1, expected: true },
  { operator: NumericOperator.Gte, left: 1, right: 1, expected: true },
  { operator: NumericOperator.Gte, left: 1, right: 2, expected: false },
  { operator: NumericOperator.Lte, left: 1, right: 2, expected: true },
  { operator: NumericOperator.Lte, left: 1, right: 1, expected: true },
  { operator: NumericOperator.Lte, left: 2, right: 1, expected: false },
  { operator: NumericOperator.Eq, left: 1, right: 1, expected: true },
  { operator: NumericOperator.Eq, left: 1, right: 2, expected: false },
  { operator: NumericOperator.Neq, left: 1, right: 2, expected: true },
  { operator: NumericOperator.Neq, left: 1, right: 1, expected: false },
];

describe('evaluateComparison', () => {
  for (const { operator, left, right, expected } of cases) {
    it(`${operator}(${left}, ${right}) === ${expected}`, () => {
      expect(evaluateComparison(operator, num(left), num(right))).toBe(expected);
    });
  }

  it('returns false (does not throw) when the left operand is NaN', () => {
    expect(evaluateComparison(NumericOperator.Gt, num(Number.NaN), num(1))).toBe(false);
  });

  it('returns false (does not throw) when the right operand is NaN', () => {
    expect(evaluateComparison(NumericOperator.Eq, num(1), num(Number.NaN))).toBe(false);
  });

  it('returns false when the left operand is null', () => {
    expect(evaluateComparison(NumericOperator.Gt, null, num(1))).toBe(false);
  });

  it('returns false when the right operand is null', () => {
    expect(evaluateComparison(NumericOperator.Gt, num(1), null)).toBe(false);
  });

  it('returns false when an operand is not a Number StateValue', () => {
    expect(
      evaluateComparison(NumericOperator.Eq, num(1), { type: StateValueType.Bool, value: true }),
    ).toBe(false);
  });
});
