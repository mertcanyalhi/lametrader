import {
  ChannelOperator,
  ComparisonOperator,
  type ConditionOperand,
  CrossingOperator,
  LeafConditionFamily,
  MovingOperator,
  OperandKind,
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
  EqualNot,
  type LucideIcon,
  Move,
  MoveDownRight,
  MoveUpRight,
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
    icon: EqualNot,
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
  // State — Equals / NotEquals are collapsed into the single Comparison
  // entries above (#429); the picker grafts those back into the State group
  // with the StateOperator dialect when the LHS dispatches through state
  // semantics (see `legalOperatorsFor`).
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
 * The operator families legal for a given LHS {@link ConditionOperand}.
 *
 * Branches on operand kind first, then falls back to value-kind logic:
 * - `SymbolStateRef` / `GlobalStateRef` → `[Comparison, State]` only, regardless
 *   of `valueType`.
 *   State refs collapse to a singleton series in `resolveSeries`, so Crossing /
 *   Channel / Moving silently no-op against them — hiding those families avoids
 *   misleading the user (issue #430).
 *   The `>` / `<` / `>=` / `<=` ordering comparators are narrowed by the key's
 *   type one level down in {@link legalOperatorsFor}: numeric keys keep them for
 *   thresholding, `Bool` / `String` keys drop them so only equality (grafted to
 *   `State.Equals` / `NotEquals`) + `ChangesTo` / `ChangesFrom` survive, leaving
 *   the Comparison group empty (and hidden) for those keys (issue #457).
 * - Numeric LHS — every family is legal.
 * - Bool / StringLike LHS (non-state-ref) — only the State family.
 * - Unknown LHS — keep every family available so the user can still pick.
 */
export function legalFamiliesFor(left: ConditionOperand): ReadonlySet<LeafConditionFamily> {
  if (left.kind === OperandKind.SymbolStateRef || left.kind === OperandKind.GlobalStateRef) {
    return new Set([LeafConditionFamily.Comparison, LeafConditionFamily.State]);
  }
  switch (operandValueKind(left)) {
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
 * The set of operator options that are legal given the LHS operand.
 *
 * Drives the dropdown so users can't pick an operator the family doesn't
 * support for the chosen LHS.
 *
 * The single Comparison `equals` / `not equals` entries in
 * {@link OPERATOR_OPTIONS} get grafted into the State family with the State
 * dialect (`StateOperator.Equals` / `NotEquals`) when the LHS dispatches
 * through state semantics — i.e. a `SymbolStateRef` / `GlobalStateRef`, or any
 * bool / string-like value (per issue #429's collapse decision: state-ref LHS
 * → NULL-aware state semantics).
 */
export function legalOperatorsFor(left: ConditionOperand): ReadonlyArray<OperatorOption> {
  const legalFamilies = legalFamiliesFor(left);
  const stateDispatch = isStateDispatchLhs(left);
  const dropOrdering = isNonNumericStateRef(left);
  const out: OperatorOption[] = [];
  for (const option of OPERATOR_OPTIONS) {
    if (stateDispatch && option.value === ComparisonOperator.Eq) {
      out.push({ ...option, family: LeafConditionFamily.State, value: StateOperator.Equals });
      continue;
    }
    if (stateDispatch && option.value === ComparisonOperator.Neq) {
      out.push({ ...option, family: LeafConditionFamily.State, value: StateOperator.NotEquals });
      continue;
    }
    // A Bool / String state key has no ordering: > / < / >= / <= are dropped so
    // only equality (grafted to State above) + transitions remain (issue #457).
    if (dropOrdering && ORDERING_COMPARATORS.has(option.value)) continue;
    if (legalFamilies.has(option.family)) out.push(option);
  }
  return out;
}

/**
 * The ordering comparators — the Comparison operators that only make sense
 * against a numeric operand.
 *
 * `Eq` / `Neq` are deliberately excluded: they express equality (not ordering)
 * and stay legal for every value type (grafted to State for state-ref LHS).
 */
const ORDERING_COMPARATORS: ReadonlySet<Operator> = new Set([
  ComparisonOperator.Gt,
  ComparisonOperator.Lt,
  ComparisonOperator.Gte,
  ComparisonOperator.Lte,
]);

/**
 * Whether the LHS is a `SymbolStateRef` / `GlobalStateRef` whose picked key
 * carries a non-numeric (`Bool` / `String`) type — the case where the ordering
 * comparators must be dropped from the operator list (issue #457).
 *
 * A numeric state ref keeps them for thresholding; a non-state-ref bool/string
 * LHS already excludes Comparison at the family level, so this check is scoped
 * to state refs where the family stays `[Comparison, State]`.
 */
function isNonNumericStateRef(left: ConditionOperand): boolean {
  if (left.kind !== OperandKind.SymbolStateRef && left.kind !== OperandKind.GlobalStateRef) {
    return false;
  }
  return operandValueKind(left) !== OperandValueKind.Numeric;
}

/**
 * Whether the LHS should dispatch the unified `equals` / `not equals` picker
 * entry to State semantics — `SymbolStateRef` / `GlobalStateRef`, or any LHS
 * whose value type is bool / string-like.
 *
 * Numeric non-state-ref LHSes (Price, OHLCV, numeric indicator-ref, numeric
 * literal) keep Comparison's snapshot semantics.
 */
function isStateDispatchLhs(left: ConditionOperand): boolean {
  if (left.kind === OperandKind.SymbolStateRef) return true;
  if (left.kind === OperandKind.GlobalStateRef) return true;
  const kind = operandValueKind(left);
  return kind === OperandValueKind.Bool || kind === OperandValueKind.StringLike;
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
