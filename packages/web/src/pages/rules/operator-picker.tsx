import {
  type ConditionOperand,
  NumericOperator,
  operandValueType,
  type RuleOperator,
  StateOperator,
  StateValueType,
  validateOperatorOperands,
} from '@lametrader/core';
import { Select } from '@radix-ui/themes';
import type { ReactNode } from 'react';

/** Human label for every operator — used as the dropdown option text. */
const OPERATOR_LABELS: Record<RuleOperator, string> = {
  [NumericOperator.Gt]: '>',
  [NumericOperator.Lt]: '<',
  [NumericOperator.Gte]: '>=',
  [NumericOperator.Lte]: '<=',
  [NumericOperator.Eq]: '== (numeric)',
  [NumericOperator.Neq]: '!= (numeric)',
  [NumericOperator.Crossing]: 'crossing',
  [NumericOperator.CrossingUp]: 'crossing up',
  [NumericOperator.CrossingDown]: 'crossing down',
  [StateOperator.Equals]: '== (state)',
  [StateOperator.NotEquals]: '!= (state)',
  [StateOperator.ChangesTo]: 'changes to',
  [StateOperator.ChangesFrom]: 'changes from',
};

/**
 * Return the subset of {@link RuleOperator}s the picker should offer for the
 * given left/right operands.
 *
 * The picker partitions by operand value type for UX clarity (a numeric pair
 * gets numeric operators; everything else gets state operators) and then
 * defers to core's {@link validateOperatorOperands} for the per-operator
 * legality check — so e.g. `ChangesTo` / `ChangesFrom` drop out automatically
 * when the right operand isn't a literal.
 */
export function validOperatorsFor(left: ConditionOperand, right: ConditionOperand): RuleOperator[] {
  const leftType = operandValueType(left);
  const rightType = operandValueType(right);
  const candidates: RuleOperator[] =
    leftType === StateValueType.Number && rightType === StateValueType.Number
      ? Object.values(NumericOperator)
      : Object.values(StateOperator);
  return candidates.filter((operator) => {
    try {
      validateOperatorOperands(operator, left, right);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Dropdown that only shows operators valid for the current `left` / `right`
 * operands. The caller is responsible for re-filtering / clearing the chosen
 * operator when an operand changes — see the leaf swap in
 * `ConditionTreeEditor`.
 *
 * @param value     - The currently chosen operator.
 * @param onChange  - Receives the next operator on selection.
 * @param left      - The leaf's left operand (drives the valid set).
 * @param right     - The leaf's right operand (drives the valid set).
 * @param ariaLabel - Accessible name for the dropdown trigger.
 */
export function OperatorPicker({
  value,
  onChange,
  left,
  right,
  ariaLabel,
}: {
  value: RuleOperator;
  onChange: (next: RuleOperator) => void;
  left: ConditionOperand;
  right: ConditionOperand;
  ariaLabel: string;
}): ReactNode {
  const valid = validOperatorsFor(left, right);
  return (
    <Select.Root value={value} onValueChange={(next) => onChange(next as RuleOperator)}>
      <Select.Trigger aria-label={ariaLabel} />
      <Select.Content>
        {valid.map((operator) => (
          <Select.Item key={operator} value={operator}>
            {OPERATOR_LABELS[operator]}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}
