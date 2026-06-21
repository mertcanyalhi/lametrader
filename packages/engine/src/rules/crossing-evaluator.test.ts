import { NumericOperator, type StateValue, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { type CrossingOperator, evaluateCrossing } from './crossing-evaluator.js';

const num = (value: number): StateValue => ({ type: StateValueType.Number, value });

/** A scenario with (leftPrev, leftCurrent, rightPrev, rightCurrent) per operator. */
interface CrossingCase {
  name: string;
  operator: CrossingOperator;
  leftPrev: number;
  leftCurrent: number;
  rightPrev: number;
  rightCurrent: number;
  expected: boolean;
}

const cases: CrossingCase[] = [
  {
    name: 'CrossingUp — left crosses up through right',
    operator: NumericOperator.CrossingUp,
    leftPrev: 1,
    leftCurrent: 3,
    rightPrev: 2,
    rightCurrent: 2,
    expected: true,
  },
  {
    name: 'CrossingUp — left stays below right',
    operator: NumericOperator.CrossingUp,
    leftPrev: 1,
    leftCurrent: 1.5,
    rightPrev: 2,
    rightCurrent: 2,
    expected: false,
  },
  {
    name: 'CrossingUp — left touches right but does not cross',
    operator: NumericOperator.CrossingUp,
    leftPrev: 1,
    leftCurrent: 2,
    rightPrev: 2,
    rightCurrent: 2,
    expected: false,
  },
  {
    name: 'CrossingDown — left crosses down through right',
    operator: NumericOperator.CrossingDown,
    leftPrev: 3,
    leftCurrent: 1,
    rightPrev: 2,
    rightCurrent: 2,
    expected: true,
  },
  {
    name: 'CrossingDown — left stays above right',
    operator: NumericOperator.CrossingDown,
    leftPrev: 3,
    leftCurrent: 2.5,
    rightPrev: 2,
    rightCurrent: 2,
    expected: false,
  },
  {
    name: 'CrossingDown — left touches right but does not cross',
    operator: NumericOperator.CrossingDown,
    leftPrev: 3,
    leftCurrent: 2,
    rightPrev: 2,
    rightCurrent: 2,
    expected: false,
  },
  {
    name: 'Crossing — up-crossing matches',
    operator: NumericOperator.Crossing,
    leftPrev: 1,
    leftCurrent: 3,
    rightPrev: 2,
    rightCurrent: 2,
    expected: true,
  },
  {
    name: 'Crossing — down-crossing matches',
    operator: NumericOperator.Crossing,
    leftPrev: 3,
    leftCurrent: 1,
    rightPrev: 2,
    rightCurrent: 2,
    expected: true,
  },
  {
    name: 'Crossing — no crossing (both stay below)',
    operator: NumericOperator.Crossing,
    leftPrev: 1,
    leftCurrent: 1.5,
    rightPrev: 2,
    rightCurrent: 2,
    expected: false,
  },
  {
    name: 'Crossing — touch but no crossing',
    operator: NumericOperator.Crossing,
    leftPrev: 2,
    leftCurrent: 2,
    rightPrev: 2,
    rightCurrent: 2,
    expected: false,
  },
];

describe('evaluateCrossing', () => {
  for (const {
    name,
    operator,
    leftPrev,
    leftCurrent,
    rightPrev,
    rightCurrent,
    expected,
  } of cases) {
    it(name, () => {
      expect(
        evaluateCrossing(
          operator,
          num(leftPrev),
          num(leftCurrent),
          num(rightPrev),
          num(rightCurrent),
        ),
      ).toBe(expected);
    });
  }

  it('returns false when leftPrev is null (first-ever observation)', () => {
    expect(evaluateCrossing(NumericOperator.CrossingUp, null, num(3), num(2), num(2))).toBe(false);
  });

  it('returns false when rightPrev is null', () => {
    expect(evaluateCrossing(NumericOperator.CrossingDown, num(3), num(1), null, num(2))).toBe(
      false,
    );
  });

  it('returns false when any value is NaN', () => {
    expect(
      evaluateCrossing(NumericOperator.Crossing, num(1), num(Number.NaN), num(2), num(2)),
    ).toBe(false);
  });

  it('returns false when an operand is not a Number StateValue', () => {
    expect(
      evaluateCrossing(
        NumericOperator.Crossing,
        { type: StateValueType.Bool, value: true },
        num(3),
        num(2),
        num(2),
      ),
    ).toBe(false);
  });
});
