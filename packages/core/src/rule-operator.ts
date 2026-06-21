import { operandValueType } from './condition-operand.js';
import { type ConditionOperand, OperandKind } from './condition-operand.types.js';
import { NumericOperator, type RuleOperator, StateOperator } from './rule-operator.types.js';
import { StateValueType } from './state.types.js';

/**
 * Thrown when a rule operator is paired with operands it can't legally compare
 * — caught at the validator boundary so the API/CLI surfaces a 400 with the
 * exact mismatch.
 */
export class RuleOperatorError extends Error {
  /**
   * @param message - the human-readable mismatch reason (operator name +
   *   offending operand types).
   */
  constructor(message: string) {
    super(message);
    this.name = 'RuleOperatorError';
  }
}

/**
 * Whether `operator` is a {@link NumericOperator} (vs a {@link StateOperator}).
 */
function isNumericOperator(operator: RuleOperator): operator is NumericOperator {
  return (Object.values(NumericOperator) as string[]).includes(operator);
}

/**
 * Assert that `operator` can legally compare `left` against `right`.
 *
 * Rules:
 * - Numeric operators require both operands to resolve to
 *   {@link StateValueType.Number}.
 * - `Equals` / `NotEquals` require both operands to share the same
 *   {@link StateValueType}.
 * - `ChangesTo` / `ChangesFrom` additionally require the right operand to be a
 *   {@link OperandKind.Literal}, so the target value is fixed at rule-creation
 *   time (not another moving signal).
 *
 * @param operator - the operator under test.
 * @param left - the left-hand operand.
 * @param right - the right-hand operand.
 * @throws {RuleOperatorError} when the operator is incompatible with the operands.
 */
export function validateOperatorOperands(
  operator: RuleOperator,
  left: ConditionOperand,
  right: ConditionOperand,
): void {
  const leftType = operandValueType(left);
  const rightType = operandValueType(right);

  if (isNumericOperator(operator)) {
    if (leftType !== StateValueType.Number || rightType !== StateValueType.Number) {
      throw new RuleOperatorError(
        `Operator '${operator}' requires numeric operands; got left=${leftType}, right=${rightType}.`,
      );
    }
    return;
  }

  if (leftType !== rightType) {
    throw new RuleOperatorError(
      `Operator '${operator}' requires matching operand types; got left=${leftType}, right=${rightType}.`,
    );
  }

  if (
    (operator === StateOperator.ChangesTo || operator === StateOperator.ChangesFrom) &&
    right.kind !== OperandKind.Literal
  ) {
    throw new RuleOperatorError(
      `Operator '${operator}' requires the right operand to be a literal target; got ${right.kind}.`,
    );
  }
}
