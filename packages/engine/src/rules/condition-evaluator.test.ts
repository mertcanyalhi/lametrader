import {
  type ConditionNode,
  ConditionNodeKind,
  NumericOperator,
  OperandKind,
  RuleEventKind,
  StateOperator,
  type StateValue,
  StateValueType,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { evaluateCondition } from './condition-evaluator.js';
import { buildEvaluationContext } from './evaluation-context.js';
import type { EvaluationLookups } from './evaluation-context.types.js';

const num = (value: number): StateValue => ({ type: StateValueType.Number, value });
const bool = (value: boolean): StateValue => ({ type: StateValueType.Bool, value });
const enumValue = (value: string): StateValue => ({ type: StateValueType.Enum, value });

function emptyLookups(): EvaluationLookups {
  return {
    getCurrentValue: () => null,
    getOpenValue: () => null,
    getHighValue: () => null,
    getLowValue: () => null,
    getCloseValue: () => null,
    getVolumeValue: () => null,
    getIndicatorValue: () => null,
    getSymbolState: () => null,
    getGlobalState: () => null,
  };
}

function leaf(
  left: ConditionNode extends infer N
    ? N extends { kind: ConditionNodeKind.Leaf }
      ? N['left']
      : never
    : never,
  operator: ConditionNode extends infer N
    ? N extends { kind: ConditionNodeKind.Leaf }
      ? N['operator']
      : never
    : never,
  right: ConditionNode extends infer N
    ? N extends { kind: ConditionNodeKind.Leaf }
      ? N['right']
      : never
    : never,
): ConditionNode {
  return { kind: ConditionNodeKind.Leaf, left, operator, right };
}

function literal(value: StateValue) {
  return { kind: OperandKind.Literal as const, value };
}

function currentNumberOperand() {
  return { kind: OperandKind.CurrentValue as const, valueType: StateValueType.Number };
}

function priceContext(prev: number | null, current: number) {
  return buildEvaluationContext(
    {
      kind: RuleEventKind.CurrentValueChanged,
      ts: 0,
      symbolId: 'AAPL',
      prev,
      current,
      final: false,
    },
    { ...emptyLookups(), getCurrentValue: () => current },
    'profile-1',
  );
}

describe('evaluateCondition — comparison operators', () => {
  it('returns true when current > literal', () => {
    const context = priceContext(1, 5);
    expect(
      evaluateCondition(leaf(currentNumberOperand(), NumericOperator.Gt, literal(num(3))), context),
    ).toBe(true);
  });

  it('returns false when current < literal', () => {
    const context = priceContext(1, 2);
    expect(
      evaluateCondition(leaf(currentNumberOperand(), NumericOperator.Gt, literal(num(3))), context),
    ).toBe(false);
  });

  it('returns true for gte on equal operands', () => {
    const context = priceContext(0, 3);
    expect(
      evaluateCondition(
        leaf(currentNumberOperand(), NumericOperator.Gte, literal(num(3))),
        context,
      ),
    ).toBe(true);
  });

  it('returns true for eq on equal operands', () => {
    const context = priceContext(0, 3);
    expect(
      evaluateCondition(leaf(currentNumberOperand(), NumericOperator.Eq, literal(num(3))), context),
    ).toBe(true);
  });

  it('returns true for neq on different operands', () => {
    const context = priceContext(0, 5);
    expect(
      evaluateCondition(
        leaf(currentNumberOperand(), NumericOperator.Neq, literal(num(3))),
        context,
      ),
    ).toBe(true);
  });

  it('returns false when the current value resolves to null', () => {
    const context = buildEvaluationContext(
      {
        kind: RuleEventKind.SymbolStateChanged,
        ts: 0,
        symbolId: 'AAPL',
        profileId: 'profile-1',
        key: 'k',
        prev: null,
        current: null,
      },
      emptyLookups(),
      'profile-1',
    );
    expect(
      evaluateCondition(leaf(currentNumberOperand(), NumericOperator.Gt, literal(num(3))), context),
    ).toBe(false);
  });

  it('returns false when an operand is NaN', () => {
    const context = priceContext(0, Number.NaN);
    expect(
      evaluateCondition(leaf(currentNumberOperand(), NumericOperator.Gt, literal(num(3))), context),
    ).toBe(false);
  });

  it('returns false when an operand has a non-Number StateValueType', () => {
    const context = priceContext(0, 3);
    expect(
      evaluateCondition(
        leaf(currentNumberOperand(), NumericOperator.Eq, literal(bool(true))),
        context,
      ),
    ).toBe(false);
  });
});

describe('evaluateCondition — crossing operators', () => {
  it('returns true on a crossing-up (prev≤right ∧ current>right)', () => {
    const context = priceContext(1, 3);
    expect(
      evaluateCondition(
        leaf(currentNumberOperand(), NumericOperator.CrossingUp, literal(num(2))),
        context,
      ),
    ).toBe(true);
  });

  it('returns false on a crossing-up when the left stays below right', () => {
    const context = priceContext(1, 1.5);
    expect(
      evaluateCondition(
        leaf(currentNumberOperand(), NumericOperator.CrossingUp, literal(num(2))),
        context,
      ),
    ).toBe(false);
  });

  it('returns true on a crossing-down (prev≥right ∧ current<right)', () => {
    const context = priceContext(3, 1);
    expect(
      evaluateCondition(
        leaf(currentNumberOperand(), NumericOperator.CrossingDown, literal(num(2))),
        context,
      ),
    ).toBe(true);
  });

  it('returns true on a Crossing when either direction matches', () => {
    const context = priceContext(3, 1);
    expect(
      evaluateCondition(
        leaf(currentNumberOperand(), NumericOperator.Crossing, literal(num(2))),
        context,
      ),
    ).toBe(true);
  });

  it('returns false when prev is null (first-ever observation)', () => {
    const context = priceContext(null, 3);
    expect(
      evaluateCondition(
        leaf(currentNumberOperand(), NumericOperator.CrossingUp, literal(num(2))),
        context,
      ),
    ).toBe(false);
  });
});

describe('evaluateCondition — state operators', () => {
  it('returns true on Equals when both operands are identical concrete values', () => {
    const ref = {
      kind: OperandKind.SymbolStateRef as const,
      key: 't',
      valueType: StateValueType.Enum,
    };
    const context = buildEvaluationContext(
      {
        kind: RuleEventKind.SymbolStateChanged,
        ts: 0,
        symbolId: 'AAPL',
        profileId: 'profile-1',
        key: 't',
        prev: enumValue('down'),
        current: enumValue('up'),
      },
      {
        ...emptyLookups(),
        getSymbolState: () => enumValue('up'),
      },
      'profile-1',
    );
    expect(
      evaluateCondition(leaf(ref, StateOperator.Equals, literal(enumValue('up'))), context),
    ).toBe(true);
  });

  it('returns false on Equals when types differ', () => {
    const ref = {
      kind: OperandKind.SymbolStateRef as const,
      key: 't',
      valueType: StateValueType.Enum,
    };
    const context = buildEvaluationContext(
      {
        kind: RuleEventKind.SymbolStateChanged,
        ts: 0,
        symbolId: 'AAPL',
        profileId: 'profile-1',
        key: 't',
        prev: null,
        current: bool(true),
      },
      {
        ...emptyLookups(),
        getSymbolState: () => bool(true),
      },
      'profile-1',
    );
    expect(
      evaluateCondition(leaf(ref, StateOperator.Equals, literal(enumValue('true'))), context),
    ).toBe(false);
  });

  it('returns true on NotEquals (null, concrete) — the bootstrap pattern', () => {
    const ref = {
      kind: OperandKind.SymbolStateRef as const,
      key: 'signal',
      valueType: StateValueType.Enum,
    };
    const context = buildEvaluationContext(
      {
        kind: RuleEventKind.CurrentValueChanged,
        ts: 0,
        symbolId: 'AAPL',
        prev: null,
        current: 0,
        final: false,
      },
      emptyLookups(),
      'profile-1',
    );
    expect(
      evaluateCondition(leaf(ref, StateOperator.NotEquals, literal(enumValue('SELL'))), context),
    ).toBe(true);
  });

  it('returns true on ChangesTo when prev !== target and current === target', () => {
    const ref = {
      kind: OperandKind.SymbolStateRef as const,
      key: 't',
      valueType: StateValueType.Enum,
    };
    const context = buildEvaluationContext(
      {
        kind: RuleEventKind.SymbolStateChanged,
        ts: 0,
        symbolId: 'AAPL',
        profileId: 'profile-1',
        key: 't',
        prev: enumValue('down'),
        current: enumValue('up'),
      },
      emptyLookups(),
      'profile-1',
    );
    expect(
      evaluateCondition(leaf(ref, StateOperator.ChangesTo, literal(enumValue('up'))), context),
    ).toBe(true);
  });

  it('returns true on ChangesFrom when prev === source and current === null', () => {
    const ref = {
      kind: OperandKind.SymbolStateRef as const,
      key: 't',
      valueType: StateValueType.Enum,
    };
    const context = buildEvaluationContext(
      {
        kind: RuleEventKind.SymbolStateChanged,
        ts: 0,
        symbolId: 'AAPL',
        profileId: 'profile-1',
        key: 't',
        prev: enumValue('up'),
        current: null,
      },
      emptyLookups(),
      'profile-1',
    );
    expect(
      evaluateCondition(leaf(ref, StateOperator.ChangesFrom, literal(enumValue('up'))), context),
    ).toBe(true);
  });
});

describe('evaluateCondition — tree walk', () => {
  function trueLeaf(): ConditionNode {
    return leaf(literal(num(1)), NumericOperator.Gt, literal(num(0)));
  }

  function falseLeaf(): ConditionNode {
    return leaf(literal(num(0)), NumericOperator.Gt, literal(num(1)));
  }

  it('returns the leaf result for a single Leaf', () => {
    const context = priceContext(0, 1);
    expect(evaluateCondition(trueLeaf(), context)).toBe(true);
    expect(evaluateCondition(falseLeaf(), context)).toBe(false);
  });

  it('And returns true when every child is true', () => {
    const context = priceContext(0, 1);
    const tree: ConditionNode = {
      kind: ConditionNodeKind.And,
      children: [trueLeaf(), trueLeaf(), trueLeaf()],
    };
    expect(evaluateCondition(tree, context)).toBe(true);
  });

  it('And returns false when any child is false', () => {
    const context = priceContext(0, 1);
    const tree: ConditionNode = {
      kind: ConditionNodeKind.And,
      children: [trueLeaf(), falseLeaf(), trueLeaf()],
    };
    expect(evaluateCondition(tree, context)).toBe(false);
  });

  it('And short-circuits on the first false (later leaves are not visited)', () => {
    const context = priceContext(0, 1);
    let visits = 0;
    const probe = (id: number): ConditionNode => ({
      kind: ConditionNodeKind.Leaf,
      left: {
        kind: OperandKind.IndicatorRef,
        instanceId: `probe-${id}`,
        stateKey: 'v',
        valueType: StateValueType.Number,
      },
      operator: NumericOperator.Gt,
      right: literal(num(0)),
    });
    const trackingLookups: EvaluationLookups = {
      ...emptyLookups(),
      getIndicatorValue: () => {
        visits++;
        return null;
      },
    };
    const trackingContext = buildEvaluationContext(
      {
        kind: RuleEventKind.CurrentValueChanged,
        ts: 0,
        symbolId: 'AAPL',
        prev: null,
        current: 1,
        final: false,
      },
      trackingLookups,
      'profile-1',
    );
    const tree: ConditionNode = {
      kind: ConditionNodeKind.And,
      children: [probe(1), probe(2), probe(3)],
    };
    evaluateCondition(tree, trackingContext);
    // First leaf's null indicator yields false → And short-circuits before the
    // remaining two leaves get a chance to lookup. Comparison ops only resolve
    // each operand once; the right operand here is a literal so doesn't hit
    // the indicator getter at all.
    expect(visits).toBe(1);
    void context;
  });

  it('Or returns true once any child is true', () => {
    const context = priceContext(0, 1);
    const tree: ConditionNode = {
      kind: ConditionNodeKind.Or,
      children: [falseLeaf(), trueLeaf(), falseLeaf()],
    };
    expect(evaluateCondition(tree, context)).toBe(true);
  });

  it('Or returns false when every child is false', () => {
    const context = priceContext(0, 1);
    const tree: ConditionNode = {
      kind: ConditionNodeKind.Or,
      children: [falseLeaf(), falseLeaf()],
    };
    expect(evaluateCondition(tree, context)).toBe(false);
  });

  it('walks a deeply nested mix of And/Or correctly', () => {
    const context = priceContext(0, 1);
    const tree: ConditionNode = {
      kind: ConditionNodeKind.And,
      children: [
        trueLeaf(),
        {
          kind: ConditionNodeKind.Or,
          children: [falseLeaf(), trueLeaf()],
        },
      ],
    };
    expect(evaluateCondition(tree, context)).toBe(true);
  });
});
