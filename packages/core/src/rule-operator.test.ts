import { describe, expect, it } from 'vitest';

import { type ConditionOperand, OperandKind } from './condition-operand.types.js';
import { RuleOperatorError, validateOperatorOperands } from './rule-operator.js';
import { NumericOperator, StateOperator } from './rule-operator.types.js';
import { StateValueType } from './state.types.js';

/** A numeric operand (Current value reads). */
const numericA: ConditionOperand = {
  kind: OperandKind.CurrentValue,
  valueType: StateValueType.Number,
};
/** A second numeric operand (Open value reads). */
const numericB: ConditionOperand = {
  kind: OperandKind.OpenValue,
  valueType: StateValueType.Number,
};
/** A bool symbol-state ref. */
const boolState: ConditionOperand = {
  kind: OperandKind.SymbolStateRef,
  key: 'armed',
  valueType: StateValueType.Bool,
};
/** A bool literal. */
const boolLiteral: ConditionOperand = {
  kind: OperandKind.Literal,
  value: { type: StateValueType.Bool, value: true },
};
/** An enum symbol-state ref. */
const enumState: ConditionOperand = {
  kind: OperandKind.SymbolStateRef,
  key: 'trend',
  valueType: StateValueType.Enum,
};
/** An enum literal. */
const enumLiteral: ConditionOperand = {
  kind: OperandKind.Literal,
  value: { type: StateValueType.Enum, value: 'up' },
};
/** A second enum ref (indicator-backed). */
const enumIndicator: ConditionOperand = {
  kind: OperandKind.IndicatorRef,
  instanceId: 'macd',
  stateKey: 'signal',
  valueType: StateValueType.Enum,
};

describe('validateOperatorOperands — numeric operators', () => {
  for (const operator of Object.values(NumericOperator)) {
    it(`accepts ${operator} on two numeric operands`, () => {
      expect(() => validateOperatorOperands(operator, numericA, numericB)).not.toThrow();
    });

    it(`rejects ${operator} when either operand is non-numeric`, () => {
      expect(() => validateOperatorOperands(operator, numericA, boolLiteral)).toThrow(
        RuleOperatorError,
      );
      expect(() => validateOperatorOperands(operator, boolState, numericB)).toThrow(
        RuleOperatorError,
      );
    });
  }
});

describe('validateOperatorOperands — Equals / NotEquals', () => {
  for (const operator of [StateOperator.Equals, StateOperator.NotEquals]) {
    it(`accepts ${operator} on matching value types`, () => {
      expect(() => validateOperatorOperands(operator, boolState, boolLiteral)).not.toThrow();
      expect(() => validateOperatorOperands(operator, enumState, enumIndicator)).not.toThrow();
    });

    it(`rejects ${operator} on mismatched value types`, () => {
      expect(() => validateOperatorOperands(operator, boolState, enumLiteral)).toThrow(
        RuleOperatorError,
      );
    });
  }
});

describe('validateOperatorOperands — ChangesTo / ChangesFrom', () => {
  for (const operator of [StateOperator.ChangesTo, StateOperator.ChangesFrom]) {
    it(`accepts ${operator} when right is a same-type literal`, () => {
      expect(() => validateOperatorOperands(operator, enumState, enumLiteral)).not.toThrow();
    });

    it(`rejects ${operator} when right is not a literal`, () => {
      expect(() => validateOperatorOperands(operator, enumState, enumIndicator)).toThrow(
        RuleOperatorError,
      );
    });

    it(`rejects ${operator} when right literal type doesn't match left`, () => {
      expect(() => validateOperatorOperands(operator, enumState, boolLiteral)).toThrow(
        RuleOperatorError,
      );
    });
  }
});
