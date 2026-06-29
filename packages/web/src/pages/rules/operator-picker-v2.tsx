import { RulesV2 } from '@lametrader/core';
import { Select } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { OperandValueKind, operandValueKind } from '../../lib/rule-v2-form-schema.js';

/**
 * Display label + family + raw value for one operator option in the picker.
 *
 * The `family` drives the leaf layout (binary / ternary / unary+tuple); the
 * picker uses it to pick the right `LeafCondition` shape on selection.
 */
export interface OperatorOption {
  /** The leaf family this operator belongs to. */
  family: RulesV2.LeafConditionFamily;
  /** The operator's persisted tag (the enum value). */
  value: RulesV2.Operator;
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
    family: RulesV2.LeafConditionFamily.Comparison,
    value: RulesV2.ComparisonOperator.Gt,
    label: 'greater than',
  },
  {
    family: RulesV2.LeafConditionFamily.Comparison,
    value: RulesV2.ComparisonOperator.Lt,
    label: 'less than',
  },
  {
    family: RulesV2.LeafConditionFamily.Comparison,
    value: RulesV2.ComparisonOperator.Gte,
    label: 'greater than or equal',
  },
  {
    family: RulesV2.LeafConditionFamily.Comparison,
    value: RulesV2.ComparisonOperator.Lte,
    label: 'less than or equal',
  },
  {
    family: RulesV2.LeafConditionFamily.Comparison,
    value: RulesV2.ComparisonOperator.Eq,
    label: 'equals',
  },
  {
    family: RulesV2.LeafConditionFamily.Comparison,
    value: RulesV2.ComparisonOperator.Neq,
    label: 'not equals',
  },
  // Crossing
  {
    family: RulesV2.LeafConditionFamily.Crossing,
    value: RulesV2.CrossingOperator.Crossing,
    label: 'crossing',
  },
  {
    family: RulesV2.LeafConditionFamily.Crossing,
    value: RulesV2.CrossingOperator.CrossingUp,
    label: 'crossing up',
  },
  {
    family: RulesV2.LeafConditionFamily.Crossing,
    value: RulesV2.CrossingOperator.CrossingDown,
    label: 'crossing down',
  },
  // Channel
  {
    family: RulesV2.LeafConditionFamily.Channel,
    value: RulesV2.ChannelOperator.EnteringChannel,
    label: 'entering channel',
  },
  {
    family: RulesV2.LeafConditionFamily.Channel,
    value: RulesV2.ChannelOperator.ExitingChannel,
    label: 'exiting channel',
  },
  {
    family: RulesV2.LeafConditionFamily.Channel,
    value: RulesV2.ChannelOperator.InsideChannel,
    label: 'inside channel',
  },
  // Moving
  {
    family: RulesV2.LeafConditionFamily.Moving,
    value: RulesV2.MovingOperator.MovingUp,
    label: 'moving up',
  },
  {
    family: RulesV2.LeafConditionFamily.Moving,
    value: RulesV2.MovingOperator.MovingDown,
    label: 'moving down',
  },
  {
    family: RulesV2.LeafConditionFamily.Moving,
    value: RulesV2.MovingOperator.MovingUpPercent,
    label: 'moving up %',
  },
  {
    family: RulesV2.LeafConditionFamily.Moving,
    value: RulesV2.MovingOperator.MovingDownPercent,
    label: 'moving down %',
  },
  // State
  {
    family: RulesV2.LeafConditionFamily.State,
    value: RulesV2.StateOperator.Equals,
    label: 'state equals',
  },
  {
    family: RulesV2.LeafConditionFamily.State,
    value: RulesV2.StateOperator.NotEquals,
    label: 'state not equals',
  },
  {
    family: RulesV2.LeafConditionFamily.State,
    value: RulesV2.StateOperator.ChangesTo,
    label: 'changes to',
  },
  {
    family: RulesV2.LeafConditionFamily.State,
    value: RulesV2.StateOperator.ChangesFrom,
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
export function legalFamiliesFor(kind: OperandValueKind): ReadonlySet<RulesV2.LeafConditionFamily> {
  switch (kind) {
    case OperandValueKind.Numeric:
      return new Set([
        RulesV2.LeafConditionFamily.Comparison,
        RulesV2.LeafConditionFamily.Crossing,
        RulesV2.LeafConditionFamily.Channel,
        RulesV2.LeafConditionFamily.Moving,
        RulesV2.LeafConditionFamily.State,
      ]);
    case OperandValueKind.Bool:
    case OperandValueKind.StringLike:
      return new Set([RulesV2.LeafConditionFamily.State]);
    case OperandValueKind.Unknown:
      return new Set(Object.values(RulesV2.LeafConditionFamily));
  }
}

/**
 * The set of operator options that are legal given the LHS value kind.
 *
 * Drives the dropdown so users can't pick an operator the family doesn't
 * support for the chosen LHS.
 */
export function legalOperatorsFor(left: RulesV2.ConditionOperand): ReadonlyArray<OperatorOption> {
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
export function OperatorPickerV2({
  value,
  left,
  onChange,
  ariaLabel,
}: {
  /** The current operator tag. */
  value: RulesV2.Operator;
  /** The LHS operand, used to filter legal operators. */
  left: RulesV2.ConditionOperand;
  /** Called with the next operator + its family. */
  onChange: (next: { operator: RulesV2.Operator; family: RulesV2.LeafConditionFamily }) => void;
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
