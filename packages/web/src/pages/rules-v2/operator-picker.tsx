import { RulesV2, StateValueType } from '@lametrader/core';
import { Select } from '@radix-ui/themes';
import type { ReactNode } from 'react';

import { operandV2ValueType } from './operand-picker.js';

/** Display label for every v2 leaf operator — used as the dropdown option text. */
const OPERATOR_LABELS: Record<RulesV2.Operator, string> = {
  [RulesV2.ComparisonOperator.Gt]: '> (greater than)',
  [RulesV2.ComparisonOperator.Lt]: '< (less than)',
  [RulesV2.ComparisonOperator.Gte]: '>= (greater or equal)',
  [RulesV2.ComparisonOperator.Lte]: '<= (less or equal)',
  [RulesV2.ComparisonOperator.Eq]: '== (numeric equal)',
  [RulesV2.ComparisonOperator.Neq]: '!= (numeric not equal)',
  [RulesV2.CrossingOperator.Crossing]: 'crossing',
  [RulesV2.CrossingOperator.CrossingUp]: 'crossing up',
  [RulesV2.CrossingOperator.CrossingDown]: 'crossing down',
  [RulesV2.ChannelOperator.EnteringChannel]: 'entering channel',
  [RulesV2.ChannelOperator.ExitingChannel]: 'exiting channel',
  [RulesV2.ChannelOperator.InsideChannel]: 'inside channel',
  [RulesV2.MovingOperator.MovingUp]: 'moving up',
  [RulesV2.MovingOperator.MovingDown]: 'moving down',
  [RulesV2.MovingOperator.MovingUpPercent]: 'moving up (%)',
  [RulesV2.MovingOperator.MovingDownPercent]: 'moving down (%)',
  [RulesV2.StateOperator.Equals]: '== (state equal)',
  [RulesV2.StateOperator.NotEquals]: '!= (state not equal)',
  [RulesV2.StateOperator.ChangesTo]: 'changes to',
  [RulesV2.StateOperator.ChangesFrom]: 'changes from',
};

/** Operator → its family — drives the leaf shape (`comparison` / `crossing` / `channel` / `moving` / `state`). */
const OPERATOR_FAMILY: Record<RulesV2.Operator, RulesV2.LeafConditionFamily> = {
  [RulesV2.ComparisonOperator.Gt]: RulesV2.LeafConditionFamily.Comparison,
  [RulesV2.ComparisonOperator.Lt]: RulesV2.LeafConditionFamily.Comparison,
  [RulesV2.ComparisonOperator.Gte]: RulesV2.LeafConditionFamily.Comparison,
  [RulesV2.ComparisonOperator.Lte]: RulesV2.LeafConditionFamily.Comparison,
  [RulesV2.ComparisonOperator.Eq]: RulesV2.LeafConditionFamily.Comparison,
  [RulesV2.ComparisonOperator.Neq]: RulesV2.LeafConditionFamily.Comparison,
  [RulesV2.CrossingOperator.Crossing]: RulesV2.LeafConditionFamily.Crossing,
  [RulesV2.CrossingOperator.CrossingUp]: RulesV2.LeafConditionFamily.Crossing,
  [RulesV2.CrossingOperator.CrossingDown]: RulesV2.LeafConditionFamily.Crossing,
  [RulesV2.ChannelOperator.EnteringChannel]: RulesV2.LeafConditionFamily.Channel,
  [RulesV2.ChannelOperator.ExitingChannel]: RulesV2.LeafConditionFamily.Channel,
  [RulesV2.ChannelOperator.InsideChannel]: RulesV2.LeafConditionFamily.Channel,
  [RulesV2.MovingOperator.MovingUp]: RulesV2.LeafConditionFamily.Moving,
  [RulesV2.MovingOperator.MovingDown]: RulesV2.LeafConditionFamily.Moving,
  [RulesV2.MovingOperator.MovingUpPercent]: RulesV2.LeafConditionFamily.Moving,
  [RulesV2.MovingOperator.MovingDownPercent]: RulesV2.LeafConditionFamily.Moving,
  [RulesV2.StateOperator.Equals]: RulesV2.LeafConditionFamily.State,
  [RulesV2.StateOperator.NotEquals]: RulesV2.LeafConditionFamily.State,
  [RulesV2.StateOperator.ChangesTo]: RulesV2.LeafConditionFamily.State,
  [RulesV2.StateOperator.ChangesFrom]: RulesV2.LeafConditionFamily.State,
};

/** Lookup the family for a given v2 operator. */
export function familyForOperatorV2(operator: RulesV2.Operator): RulesV2.LeafConditionFamily {
  return OPERATOR_FAMILY[operator];
}

/**
 * Return the operators the picker should offer given the resolved value types
 * of both operands. The semantics mirror the v2 boundary schema + engine:
 *
 * - Comparison / Crossing / Channel / Moving operators apply only when both
 *   operand types are `Number` (OHLCV, Price, numeric literals, numeric refs).
 * - State operators (`Equals`, `NotEquals`, `ChangesTo`, `ChangesFrom`) apply
 *   when the two operand types match (any `StateValueType`); they are the
 *   only legal choice for non-numeric pairs.
 *
 * The leaf shape is then picked from the operator's family in
 * {@link familyForOperatorV2}; Channel/Moving families have separate operand
 * slots managed by the leaf row.
 */
export function validOperatorsV2For(
  left: StateValueType,
  right: StateValueType | undefined,
): RulesV2.Operator[] {
  const operators: RulesV2.Operator[] = [];
  const numericPair = left === StateValueType.Number && right === StateValueType.Number;
  const noRight = right === undefined;
  if (numericPair || noRight) {
    operators.push(...Object.values(RulesV2.ComparisonOperator));
    operators.push(...Object.values(RulesV2.CrossingOperator));
    operators.push(...Object.values(RulesV2.ChannelOperator));
    operators.push(...Object.values(RulesV2.MovingOperator));
  }
  const sameType = right !== undefined && right === left;
  if (sameType || noRight) {
    operators.push(...Object.values(RulesV2.StateOperator));
  }
  return operators;
}

/**
 * Dropdown that only shows operators valid for the current `left` / `right`
 * operand value types. The caller (the leaf row) is responsible for adjusting
 * the leaf's family when an operator from a different family is picked — see
 * {@link familyForOperatorV2}.
 *
 * @param value     - The currently chosen operator.
 * @param onChange  - Receives the next operator on selection.
 * @param left      - The leaf's left operand.
 * @param right     - The leaf's right operand (undefined for Moving leaves).
 * @param ariaLabel - Accessible name for the dropdown trigger.
 */
export function OperatorPickerV2({
  value,
  onChange,
  left,
  right,
  ariaLabel,
}: {
  value: RulesV2.Operator;
  onChange: (next: RulesV2.Operator) => void;
  left: RulesV2.ConditionOperand;
  right: RulesV2.ConditionOperand | undefined;
  ariaLabel: string;
}): ReactNode {
  const valid = validOperatorsV2For(
    operandV2ValueType(left),
    right === undefined ? undefined : operandV2ValueType(right),
  );
  return (
    <Select.Root value={value} onValueChange={(next) => onChange(next as RulesV2.Operator)}>
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
