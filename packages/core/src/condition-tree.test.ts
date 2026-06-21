import { describe, expect, it } from 'vitest';

import { type ConditionOperand, OperandKind } from './condition-operand.types.js';
import { RuleConditionError, validateConditionTree } from './condition-tree.js';
import { type ConditionNode, ConditionNodeKind } from './condition-tree.types.js';
import { RuleOperatorError } from './rule-operator.js';
import { NumericOperator } from './rule-operator.types.js';
import { StateValueType } from './state.types.js';

/** Two numeric operands reused across leaves. */
const current: ConditionOperand = {
  kind: OperandKind.CurrentValue,
  valueType: StateValueType.Number,
};
const literalNumber: ConditionOperand = {
  kind: OperandKind.Literal,
  value: { type: StateValueType.Number, value: 100 },
};
const literalBool: ConditionOperand = {
  kind: OperandKind.Literal,
  value: { type: StateValueType.Bool, value: true },
};

/** A valid `current > 100` leaf. */
const validLeaf: ConditionNode = {
  kind: ConditionNodeKind.Leaf,
  left: current,
  operator: NumericOperator.Gt,
  right: literalNumber,
};

/** A leaf that fails type compatibility (`Gt` with a bool operand). */
const invalidLeaf: ConditionNode = {
  kind: ConditionNodeKind.Leaf,
  left: current,
  operator: NumericOperator.Gt,
  right: literalBool,
};

describe('validateConditionTree', () => {
  it('accepts a valid single leaf', () => {
    expect(() => validateConditionTree(validLeaf)).not.toThrow();
  });

  it('accepts a deeply nested mix of And/Or groups around valid leaves', () => {
    const tree: ConditionNode = {
      kind: ConditionNodeKind.And,
      children: [
        validLeaf,
        {
          kind: ConditionNodeKind.Or,
          children: [validLeaf, { kind: ConditionNodeKind.And, children: [validLeaf] }],
        },
      ],
    };
    expect(() => validateConditionTree(tree)).not.toThrow();
  });

  it('rejects an empty And group', () => {
    expect(() => validateConditionTree({ kind: ConditionNodeKind.And, children: [] })).toThrow(
      RuleConditionError,
    );
  });

  it('rejects an empty Or group', () => {
    expect(() => validateConditionTree({ kind: ConditionNodeKind.Or, children: [] })).toThrow(
      RuleConditionError,
    );
  });

  it('rejects an empty nested group inside an otherwise valid tree', () => {
    const tree: ConditionNode = {
      kind: ConditionNodeKind.And,
      children: [validLeaf, { kind: ConditionNodeKind.Or, children: [] }],
    };
    expect(() => validateConditionTree(tree)).toThrow(RuleConditionError);
  });

  it('propagates leaf operator/operand type errors from any depth', () => {
    const tree: ConditionNode = {
      kind: ConditionNodeKind.And,
      children: [validLeaf, { kind: ConditionNodeKind.Or, children: [invalidLeaf] }],
    };
    expect(() => validateConditionTree(tree)).toThrow(RuleOperatorError);
  });
});
