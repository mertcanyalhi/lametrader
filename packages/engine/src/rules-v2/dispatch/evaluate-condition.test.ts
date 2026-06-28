import { RulesV2, type StateValue, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import type { EvaluationContext } from '../evaluation-context.types.js';
import type { SeriesView } from '../series.types.js';
import { evaluateCondition } from './evaluate-condition.js';

/**
 * Minimal fake context — operators only need `resolveLatest` here.
 * Returns the literal's value for literals, and the canned value otherwise.
 */
function fakeContext(latest: Map<string, StateValue | null>): EvaluationContext {
  const emptySeries: SeriesView = {
    length: 0,
    backwardWalk: () => [].values(),
    asOf: () => null,
  };
  return {
    symbolId: 'AAPL',
    resolveLatest(operand) {
      if (operand.kind === RulesV2.OperandKind.Literal) return operand.value;
      return latest.get(operand.kind) ?? null;
    },
    resolvePrev(operand) {
      if (operand.kind === RulesV2.OperandKind.Literal) return operand.value;
      return null;
    },
    resolveSeries() {
      return emptySeries;
    },
  };
}

function leafGtLiteral(left: RulesV2.ConditionOperand, rhs: number): RulesV2.ConditionNode {
  return {
    kind: RulesV2.ConditionNodeKind.Leaf,
    leaf: {
      family: RulesV2.LeafConditionFamily.Comparison,
      operator: RulesV2.ComparisonOperator.Gt,
      left,
      right: {
        kind: RulesV2.OperandKind.Literal,
        value: { type: StateValueType.Number, value: rhs },
      },
    },
  };
}

describe('evaluateCondition — tree walker', () => {
  it('returns true on a single leaf whose operator returns true', () => {
    const ctx = fakeContext(
      new Map([[RulesV2.OperandKind.Price as string, { type: StateValueType.Number, value: 120 }]]),
    );
    const tree = leafGtLiteral({ kind: RulesV2.OperandKind.Price }, 100);
    expect(evaluateCondition(tree, ctx)).toEqual(true);
  });

  it('returns false on a single leaf whose operator returns false', () => {
    const ctx = fakeContext(
      new Map([[RulesV2.OperandKind.Price as string, { type: StateValueType.Number, value: 80 }]]),
    );
    const tree = leafGtLiteral({ kind: RulesV2.OperandKind.Price }, 100);
    expect(evaluateCondition(tree, ctx)).toEqual(false);
  });

  it('returns true on an And of two true leaves', () => {
    const ctx = fakeContext(
      new Map([[RulesV2.OperandKind.Price as string, { type: StateValueType.Number, value: 120 }]]),
    );
    const tree: RulesV2.ConditionNode = {
      kind: RulesV2.ConditionNodeKind.And,
      children: [
        leafGtLiteral({ kind: RulesV2.OperandKind.Price }, 100),
        leafGtLiteral({ kind: RulesV2.OperandKind.Price }, 110),
      ],
    };
    expect(evaluateCondition(tree, ctx)).toEqual(true);
  });

  it('returns false on an And short-circuiting on the first false leaf', () => {
    const ctx = fakeContext(
      new Map([[RulesV2.OperandKind.Price as string, { type: StateValueType.Number, value: 80 }]]),
    );
    const tree: RulesV2.ConditionNode = {
      kind: RulesV2.ConditionNodeKind.And,
      children: [
        leafGtLiteral({ kind: RulesV2.OperandKind.Price }, 100),
        leafGtLiteral({ kind: RulesV2.OperandKind.Price }, 50),
      ],
    };
    expect(evaluateCondition(tree, ctx)).toEqual(false);
  });

  it('returns true on an Or short-circuiting on the first true leaf', () => {
    const ctx = fakeContext(
      new Map([[RulesV2.OperandKind.Price as string, { type: StateValueType.Number, value: 120 }]]),
    );
    const tree: RulesV2.ConditionNode = {
      kind: RulesV2.ConditionNodeKind.Or,
      children: [
        leafGtLiteral({ kind: RulesV2.OperandKind.Price }, 100),
        leafGtLiteral({ kind: RulesV2.OperandKind.Price }, 200),
      ],
    };
    expect(evaluateCondition(tree, ctx)).toEqual(true);
  });

  it('returns false on an Or of two false leaves', () => {
    const ctx = fakeContext(
      new Map([[RulesV2.OperandKind.Price as string, { type: StateValueType.Number, value: 80 }]]),
    );
    const tree: RulesV2.ConditionNode = {
      kind: RulesV2.ConditionNodeKind.Or,
      children: [
        leafGtLiteral({ kind: RulesV2.OperandKind.Price }, 100),
        leafGtLiteral({ kind: RulesV2.OperandKind.Price }, 200),
      ],
    };
    expect(evaluateCondition(tree, ctx)).toEqual(false);
  });
});
