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
import { Flex, Select } from '@radix-ui/themes';
import {
  ArrowDownRight,
  ArrowLeftRight,
  ArrowRightLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Equal,
  type LucideIcon,
  Move,
  MoveDownRight,
  MoveUpRight,
  Slash,
  Square,
  SquareArrowOutDownLeft,
  SquareArrowOutUpRight,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { OperandValueKind, operandValueKind } from '../../lib/rule-form-schema.js';

/**
 * Display label + family + icon + raw value for one operator option in the picker.
 *
 * The `family` drives the leaf layout (binary / ternary / unary+tuple); the
 * picker uses it to pick the right `LeafCondition` shape on selection.
 * `icon` is a `lucide-react` component rendered next to the label.
 */
export interface OperatorOption {
  /** The leaf family this operator belongs to. */
  family: LeafConditionFamily;
  /** The operator's persisted tag (the enum value). */
  value: Operator;
  /** Human-readable label shown in the dropdown. */
  label: string;
  /** Icon component rendered next to the label. */
  icon: LucideIcon;
}

/**
 * Human-readable labels for each {@link LeafConditionFamily}, in engine order
 * (Comparison / Crossing / Channel / Moving / State).
 *
 * Surfaced as `Select.Label` headers above each family's options.
 */
export const OPERATOR_FAMILY_LABELS: Readonly<Record<LeafConditionFamily, string>> = {
  [LeafConditionFamily.Comparison]: 'Comparison',
  [LeafConditionFamily.Crossing]: 'Crossing',
  [LeafConditionFamily.Channel]: 'Channel',
  [LeafConditionFamily.Moving]: 'Moving',
  [LeafConditionFamily.State]: 'State',
};

/**
 * Every operator option, grouped by family, in their dropdown order.
 *
 * Labels render as the user-facing names from #396 (Crossing, Moving Up %, …)
 * rather than the persisted enum tags.
 * Icons are chosen semantically so the option reads visually:
 * Comparison uses chevrons + an equals sign; Crossing uses Move arrows;
 * Channel uses entry/exit/box glyphs; Moving uses trending arrows;
 * State uses equality + transition arrows.
 */
export const OPERATOR_OPTIONS: ReadonlyArray<OperatorOption> = [
  // Comparison
  {
    family: LeafConditionFamily.Comparison,
    value: ComparisonOperator.Gt,
    label: 'greater than',
    icon: ChevronRight,
  },
  {
    family: LeafConditionFamily.Comparison,
    value: ComparisonOperator.Lt,
    label: 'less than',
    icon: ChevronLeft,
  },
  {
    family: LeafConditionFamily.Comparison,
    value: ComparisonOperator.Gte,
    label: 'greater than or equal',
    icon: ChevronsRight,
  },
  {
    family: LeafConditionFamily.Comparison,
    value: ComparisonOperator.Lte,
    label: 'less than or equal',
    icon: ChevronsLeft,
  },
  {
    family: LeafConditionFamily.Comparison,
    value: ComparisonOperator.Eq,
    label: 'equals',
    icon: Equal,
  },
  {
    family: LeafConditionFamily.Comparison,
    value: ComparisonOperator.Neq,
    label: 'not equals',
    icon: Slash,
  },
  // Crossing
  {
    family: LeafConditionFamily.Crossing,
    value: CrossingOperator.Crossing,
    label: 'crossing',
    icon: Move,
  },
  {
    family: LeafConditionFamily.Crossing,
    value: CrossingOperator.CrossingUp,
    label: 'crossing up',
    icon: MoveUpRight,
  },
  {
    family: LeafConditionFamily.Crossing,
    value: CrossingOperator.CrossingDown,
    label: 'crossing down',
    icon: MoveDownRight,
  },
  // Channel
  {
    family: LeafConditionFamily.Channel,
    value: ChannelOperator.EnteringChannel,
    label: 'entering channel',
    icon: SquareArrowOutDownLeft,
  },
  {
    family: LeafConditionFamily.Channel,
    value: ChannelOperator.ExitingChannel,
    label: 'exiting channel',
    icon: SquareArrowOutUpRight,
  },
  {
    family: LeafConditionFamily.Channel,
    value: ChannelOperator.InsideChannel,
    label: 'inside channel',
    icon: Square,
  },
  // Moving
  {
    family: LeafConditionFamily.Moving,
    value: MovingOperator.MovingUp,
    label: 'moving up',
    icon: TrendingUp,
  },
  {
    family: LeafConditionFamily.Moving,
    value: MovingOperator.MovingDown,
    label: 'moving down',
    icon: TrendingDown,
  },
  {
    family: LeafConditionFamily.Moving,
    value: MovingOperator.MovingUpPercent,
    label: 'moving up %',
    icon: ArrowUpRight,
  },
  {
    family: LeafConditionFamily.Moving,
    value: MovingOperator.MovingDownPercent,
    label: 'moving down %',
    icon: ArrowDownRight,
  },
  // State
  {
    family: LeafConditionFamily.State,
    value: StateOperator.Equals,
    label: 'state equals',
    icon: Equal,
  },
  {
    family: LeafConditionFamily.State,
    value: StateOperator.NotEquals,
    label: 'state not equals',
    icon: Slash,
  },
  {
    family: LeafConditionFamily.State,
    value: StateOperator.ChangesTo,
    label: 'changes to',
    icon: ArrowRightLeft,
  },
  {
    family: LeafConditionFamily.State,
    value: StateOperator.ChangesFrom,
    label: 'changes from',
    icon: ArrowLeftRight,
  },
];

/**
 * Engine-order list of every {@link LeafConditionFamily}.
 *
 * Drives `Select.Group` headers in the picker so families render in the same
 * order as the source-of-truth enum.
 */
export const OPERATOR_FAMILY_ORDER: ReadonlyArray<LeafConditionFamily> = [
  LeafConditionFamily.Comparison,
  LeafConditionFamily.Crossing,
  LeafConditionFamily.Channel,
  LeafConditionFamily.Moving,
  LeafConditionFamily.State,
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
 *
 * Options group by {@link LeafConditionFamily} (Comparison / Crossing / Channel
 * / Moving / State) in engine order via `Select.Group` headers, and each option
 * carries its `lucide-react` icon next to the label.
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
  const grouped = groupByFamily(options);
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
        {OPERATOR_FAMILY_ORDER.map((family) => {
          const familyOptions = grouped.get(family) ?? [];
          if (familyOptions.length === 0) return null;
          return (
            <Select.Group key={family}>
              <Select.Label>{OPERATOR_FAMILY_LABELS[family]}</Select.Label>
              {familyOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <Select.Item key={option.value} value={option.value}>
                    <Flex align="center" gap="2">
                      <Icon size={14} aria-hidden="true" />
                      <span>{option.label}</span>
                    </Flex>
                  </Select.Item>
                );
              })}
            </Select.Group>
          );
        })}
      </Select.Content>
    </Select.Root>
  );
}

/**
 * Bucket operator options by their {@link LeafConditionFamily} into a map keyed
 * by family.
 *
 * Preserves the input order inside each bucket so the persisted ordering in
 * {@link OPERATOR_OPTIONS} flows through to the rendered groups.
 */
function groupByFamily(
  options: ReadonlyArray<OperatorOption>,
): Map<LeafConditionFamily, OperatorOption[]> {
  const result = new Map<LeafConditionFamily, OperatorOption[]>();
  for (const option of options) {
    const bucket = result.get(option.family);
    if (bucket) bucket.push(option);
    else result.set(option.family, [option]);
  }
  return result;
}
