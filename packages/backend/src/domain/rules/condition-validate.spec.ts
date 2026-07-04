import {
  ComparisonOperator,
  type ConditionNode,
  ConditionNodeKind,
  LeafConditionFamily,
  OperandKind,
  Period,
  StateValueType,
} from '@lametrader/core';
import { InvalidRuleConditionError } from '../rule.js';
import {
  collectConditionIntervals,
  leafNeedsInterval,
  operandNeedsInterval,
  validateRuleCondition,
} from './condition-validate.js';

/** A comparison leaf of `left > 0`, optionally carrying an interval. */
function gtLeaf(left: { kind: OperandKind.Open } | { kind: OperandKind.Price }, interval?: Period) {
  return {
    family: LeafConditionFamily.Comparison as const,
    operator: ComparisonOperator.Gt,
    left,
    right: { kind: OperandKind.Literal as const, value: { type: StateValueType.Number, value: 0 } },
    ...(interval === undefined ? {} : { interval }),
  };
}

/** A single-leaf condition tree of {@link gtLeaf}. */
function leaf(
  left: { kind: OperandKind.Open } | { kind: OperandKind.Price },
  interval?: Period,
): ConditionNode {
  return { kind: ConditionNodeKind.Leaf, leaf: gtLeaf(left, interval) };
}

describe('operandNeedsInterval', () => {
  it('is true for an OHLCV open operand', () => {
    expect(operandNeedsInterval({ kind: OperandKind.Open })).toEqual(true);
  });

  it('is false for a period-agnostic price operand', () => {
    expect(operandNeedsInterval({ kind: OperandKind.Price })).toEqual(false);
  });
});

describe('leafNeedsInterval', () => {
  it('is true for a comparison leaf whose left operand is OHLCV', () => {
    expect(leafNeedsInterval(gtLeaf({ kind: OperandKind.Open }))).toEqual(true);
  });

  it('is false for a comparison leaf over price and a literal', () => {
    expect(leafNeedsInterval(gtLeaf({ kind: OperandKind.Price }))).toEqual(false);
  });
});

describe('validateRuleCondition', () => {
  it('throws for an OHLCV leaf missing its interval', () => {
    expect(() => validateRuleCondition(leaf({ kind: OperandKind.Open }))).toThrow(
      InvalidRuleConditionError,
    );
  });

  it('passes for an OHLCV leaf carrying an interval', () => {
    expect(validateRuleCondition(leaf({ kind: OperandKind.Open }, Period.OneHour))).toEqual(
      undefined,
    );
  });

  it('passes for a price leaf with no interval', () => {
    expect(validateRuleCondition(leaf({ kind: OperandKind.Price }))).toEqual(undefined);
  });
});

describe('collectConditionIntervals', () => {
  it('returns the distinct intervals of bar-scoped leaves in first-seen order', () => {
    const tree: ConditionNode = {
      kind: ConditionNodeKind.And,
      children: [
        leaf({ kind: OperandKind.Open }, Period.OneHour),
        leaf({ kind: OperandKind.Open }, Period.OneMinute),
        leaf({ kind: OperandKind.Open }, Period.OneHour),
        leaf({ kind: OperandKind.Price }),
      ],
    };
    expect(collectConditionIntervals(tree)).toEqual([Period.OneHour, Period.OneMinute]);
  });
});
