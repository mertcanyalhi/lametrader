import {
  ChannelOperator,
  ComparisonOperator,
  type ConditionOperand,
  CrossingOperator,
  LeafConditionFamily,
  MovingOperator,
  type Operator,
  StateOperator,
} from '@lametrader/core';
import { Select } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { OperandValueKind, operandValueKind } from '../../lib/rule-form-schema.js';

/**
 * Display label + family + raw value for one operator option in the picker.
 *
 * The `family` drives the leaf layout (binary / ternary / unary+tuple); the
 * picker uses it to pick the right `LeafCondition` shape on selection.
 */
export interface OperatorOption {
  /** The leaf family this operator belongs to. */
  family: LeafConditionFamily;
  /** The operator's persisted tag (the enum value). */
  value: Operator;
  /** Human-readable label shown in the dropdown. */
  label: string;
}

/**
 * Every v2 operator option, grouped by family, in their dropdown order.
 *
 * Labels render as the user-facing names from #396 (Crossing, Moving Up %, …)
 * rather than the persisted enum tags.
 */
export const OPERATOR_OPTIONS: ReadonlyArray<OperatorOption> = [
  // Comparison
  {
    family: LeafConditionFamily.Comparison,
    value: ComparisonOperator.Gt,
    label: 'greater than',
  },
  {
    family: LeafConditionFamily.Comparison,
    value: ComparisonOperator.Lt,
    label: 'less than',
  },
  {
    family: LeafConditionFamily.Comparison,
    value: ComparisonOperator.Gte,
    label: 'greater than or equal',
  },
  {
    family: LeafConditionFamily.Comparison,
    value: ComparisonOperator.Lte,
    label: 'less than or equal',
  },
  {
    family: LeafConditionFamily.Comparison,
    value: ComparisonOperator.Eq,
    label: 'equals',
  },
  {
    family: LeafConditionFamily.Comparison,
    value: ComparisonOperator.Neq,
    label: 'not equals',
  },
  // Crossing
  {
    family: LeafConditionFamily.Crossing,
    value: CrossingOperator.Crossing,
    label: 'crossing',
  },
  {
    family: LeafConditionFamily.Crossing,
    value: CrossingOperator.CrossingUp,
    label: 'crossing up',
  },
  {
    family: LeafConditionFamily.Crossing,
    value: CrossingOperator.CrossingDown,
    label: 'crossing down',
  },
  // Channel
  {
    family: LeafConditionFamily.Channel,
    value: ChannelOperator.EnteringChannel,
    label: 'entering channel',
  },
  {
    family: LeafConditionFamily.Channel,
    value: ChannelOperator.ExitingChannel,
    label: 'exiting channel',
  },
  {
    family: LeafConditionFamily.Channel,
    value: ChannelOperator.InsideChannel,
    label: 'inside channel',
  },
  // Moving
  {
    family: LeafConditionFamily.Moving,
    value: MovingOperator.MovingUp,
    label: 'moving up',
  },
  {
    family: LeafConditionFamily.Moving,
    value: MovingOperator.MovingDown,
    label: 'moving down',
  },
  {
    family: LeafConditionFamily.Moving,
    value: MovingOperator.MovingUpPercent,
    label: 'moving up %',
  },
  {
    family: LeafConditionFamily.Moving,
    value: MovingOperator.MovingDownPercent,
    label: 'moving down %',
  },
  // State
  {
    family: LeafConditionFamily.State,
    value: StateOperator.Equals,
    label: 'state equals',
  },
  {
    family: LeafConditionFamily.State,
    value: StateOperator.NotEquals,
    label: 'state not equals',
  },
  {
    family: LeafConditionFamily.State,
    value: StateOperator.ChangesTo,
    label: 'changes to',
  },
  {
    family: LeafConditionFamily.State,
    value: StateOperator.ChangesFrom,
    label: 'changes from',
  },
];

/**
 * The operator families legal for each LHS {@link OperandValueKind}.
 *
 * Numeric LHS — everything is legal.
 * Bool / StringLike LHS — only the State family (the others are numeric-only).
 * Unknown LHS — keep every family available so the user can still pick.
 */
export function legalFamiliesFor(kind: OperandValueKind): ReadonlySet<LeafConditionFamily> {
  switch (kind) {
    case OperandValueKind.Numeric:
      return new Set([
        LeafConditionFamily.Comparison,
        LeafConditionFamily.Crossing,
        LeafConditionFamily.Channel,
        LeafConditionFamily.Moving,
        LeafConditionFamily.State,
      ]);
    case OperandValueKind.Bool:
    case OperandValueKind.StringLike:
      return new Set([LeafConditionFamily.State]);
    case OperandValueKind.Unknown:
      return new Set(Object.values(LeafConditionFamily));
  }
}

/**
 * The set of operator options that are legal given the LHS value kind.
 *
 * Drives the dropdown so users can't pick an operator the family doesn't
 * support for the chosen LHS.
 */
export function legalOperatorsFor(left: ConditionOperand): ReadonlyArray<OperatorOption> {
  const legalFamilies = legalFamiliesFor(operandValueKind(left));
  return OPERATOR_OPTIONS.filter((option) => legalFamilies.has(option.family));
}

/**
 * The operator picker — a Radix `<Select>` filtered by the LHS's
 * {@link OperandValueKind}.
 *
 * Selecting an operator emits the operator tag + its family so the leaf editor
 * can reshape the row (binary / ternary / unary+tuple) to match.
 */
export function OperatorPicker({
  value,
  left,
  onChange,
  ariaLabel,
}: {
  /** The current operator tag. */
  value: Operator;
  /** The LHS operand, used to filter legal operators. */
  left: ConditionOperand;
  /** Called with the next operator + its family. */
  onChange: (next: { operator: Operator; family: LeafConditionFamily }) => void;
  /** Accessible name for the trigger. */
  ariaLabel: string;
}): ReactNode {
  const options = legalOperatorsFor(left);
  return (
    <Select.Root
      value={value}
      onValueChange={(next) => {
        const picked = options.find((option) => option.value === next);
        if (picked) onChange({ operator: picked.value, family: picked.family });
      }}
    >
      <Select.Trigger aria-label={ariaLabel} />
      <Select.Content>
        {options.map((option) => (
          <Select.Item key={option.value} value={option.value}>
            {option.label}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}
