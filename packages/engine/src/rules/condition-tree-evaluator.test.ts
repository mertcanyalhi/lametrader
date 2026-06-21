import {
  type ConditionNode,
  ConditionNodeKind,
  NumericOperator,
  OperandKind,
  StateValueType,
} from '@lametrader/core';
import { describe, expect, it, vi } from 'vitest';

import {
  type ConditionLeaf,
  evaluateConditionTree,
  type LeafEvaluator,
} from './condition-tree-evaluator.js';

/** A reusable leaf shape — content is irrelevant; the evaluator decides. */
function leaf(): ConditionLeaf {
  return {
    kind: ConditionNodeKind.Leaf,
    left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
    operator: NumericOperator.Gt,
    right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
  };
}

/** Build a leaf evaluator from a sequence of results, one per call. */
function sequenced(results: boolean[]): LeafEvaluator {
  let index = 0;
  return () => {
    const result = results[index] ?? false;
    index += 1;
    return result;
  };
}

describe('evaluateConditionTree', () => {
  it('returns the leaf evaluator result for a single leaf', () => {
    expect(evaluateConditionTree(leaf(), () => true)).toBe(true);
    expect(evaluateConditionTree(leaf(), () => false)).toBe(false);
  });

  it('And returns true only when every child is true', () => {
    const tree: ConditionNode = {
      kind: ConditionNodeKind.And,
      children: [leaf(), leaf(), leaf()],
    };
    expect(evaluateConditionTree(tree, sequenced([true, true, true]))).toBe(true);
  });

  it('And returns false when any child is false', () => {
    const tree: ConditionNode = {
      kind: ConditionNodeKind.And,
      children: [leaf(), leaf(), leaf()],
    };
    expect(evaluateConditionTree(tree, sequenced([true, false, true]))).toBe(false);
  });

  it('Or returns true once any child is true', () => {
    const tree: ConditionNode = {
      kind: ConditionNodeKind.Or,
      children: [leaf(), leaf(), leaf()],
    };
    expect(evaluateConditionTree(tree, sequenced([false, true, false]))).toBe(true);
  });

  it('Or returns false when every child is false', () => {
    const tree: ConditionNode = {
      kind: ConditionNodeKind.Or,
      children: [leaf(), leaf()],
    };
    expect(evaluateConditionTree(tree, sequenced([false, false]))).toBe(false);
  });

  it('And short-circuits on the first false (later leaves are NOT evaluated)', () => {
    const spy = vi.fn<LeafEvaluator>().mockReturnValueOnce(false).mockReturnValue(true);
    const tree: ConditionNode = {
      kind: ConditionNodeKind.And,
      children: [leaf(), leaf(), leaf()],
    };
    evaluateConditionTree(tree, spy);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('Or short-circuits on the first true (later leaves are NOT evaluated)', () => {
    const spy = vi.fn<LeafEvaluator>().mockReturnValueOnce(true).mockReturnValue(false);
    const tree: ConditionNode = {
      kind: ConditionNodeKind.Or,
      children: [leaf(), leaf(), leaf()],
    };
    evaluateConditionTree(tree, spy);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('walks a deeply nested mix of And/Or correctly', () => {
    const tree: ConditionNode = {
      kind: ConditionNodeKind.And,
      children: [
        leaf(),
        {
          kind: ConditionNodeKind.Or,
          children: [leaf(), leaf()],
        },
      ],
    };
    // Sequence: outer-And#1=true, inner-Or#1=false, inner-Or#2=true → outer And: true && (false || true) = true.
    expect(evaluateConditionTree(tree, sequenced([true, false, true]))).toBe(true);
  });
});
