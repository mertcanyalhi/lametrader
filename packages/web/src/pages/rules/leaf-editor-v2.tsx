import { type IndicatorInstance, type Period, RulesV2, StateValueType } from '@lametrader/core';
import { Box, Flex, Select, Text, TextField } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import {
  isBoolOperand,
  OperandValueKind,
  operandValueKind,
} from '../../lib/rule-v2-form-schema.js';
import { OperandPickerV2, operandNeedsInterval } from './operand-picker-v2.js';
import { legalOperatorsFor, OPERATOR_OPTIONS, OperatorPickerV2 } from './operator-picker-v2.js';
import { PERIOD_LABELS } from './trigger-picker-v2.js';

/**
 * State keys to seed the operand pickers' state-key dropdowns with.
 *
 * Two flat lists; freetext entry is always allowed (per #396 AC).
 */
export interface KnownStateKeys {
  symbol: string[];
  global: string[];
}

/**
 * Per-instance period lookup used to filter the indicator dropdown by the row's
 * `interval` (per #396 / ADR 0016: indicator operand binding is profile-attached,
 * filtered by the row's `Interval`).
 *
 * Most v1 profile attachments have one period per instance; v2 keeps the same
 * shape but reads it explicitly through this lookup.
 */
export type InstancePeriods = Record<string, Period | undefined>;

/**
 * The leaf-condition editor.
 *
 * Walks the leaf's `family` to decide layout:
 * - Comparison / Crossing / State — two operands (LHS / RHS), an `Interval` row
 *   if either operand needs one.
 * - Channel — LHS + two bounds (Upper / Lower), `Interval` if any operand needs it.
 * - Moving — LHS + a numeric `threshold` + an integer `bars`, no RHS picker.
 *
 * When the LHS resolves to a Bool-typed operand, hides the operator + RHS rows
 * (single-operand sugar) and persists the leaf as `State / Equals` against
 * `Literal(true)` on save.
 */
export function LeafEditorV2({
  value,
  onChange,
  indicators,
  instancePeriods,
  knownStateKeys,
}: {
  value: RulesV2.LeafCondition;
  onChange: (next: RulesV2.LeafCondition) => void;
  indicators: IndicatorInstance[];
  instancePeriods: InstancePeriods;
  knownStateKeys: KnownStateKeys;
}): ReactNode {
  const left = value.left;
  const boolShortcut = isBoolOperand(left);
  const visibleIndicators = filterIndicatorsByPeriod(indicators, value.interval, instancePeriods);
  const intervalRequired = needsInterval(value);

  return (
    <Flex direction="column" gap="2">
      <Flex gap="3" align="start" wrap="wrap">
        <Box flexGrow="1" minWidth="180px">
          <Text as="div" size="1" color="gray" mb="1">
            Operand
          </Text>
          <OperandPickerV2
            value={left}
            onChange={(next) => onChange(updateLeft(value, next))}
            indicators={visibleIndicators}
            symbolStateKeys={knownStateKeys.symbol}
            globalStateKeys={knownStateKeys.global}
            ariaLabel="Left operand kind"
          />
        </Box>
        {boolShortcut ? null : (
          <Box minWidth="180px">
            <Text as="div" size="1" color="gray" mb="1">
              Operator
            </Text>
            <OperatorPickerV2
              value={value.operator}
              left={left}
              onChange={({ operator, family }) => onChange(changeOperator(value, operator, family))}
              ariaLabel="Operator"
            />
          </Box>
        )}
        {boolShortcut
          ? null
          : renderFamilyBody(value, onChange, visibleIndicators, knownStateKeys, left)}
      </Flex>
      {intervalRequired ? (
        <Flex gap="2" align="center">
          <Text size="2" color="gray">
            Interval
          </Text>
          <IntervalPicker
            value={value.interval}
            onChange={(next) => onChange({ ...value, interval: next })}
          />
        </Flex>
      ) : null}
    </Flex>
  );
}

/**
 * Render the family-specific RHS/bounds/scalar body.
 *
 * Comparison / Crossing / State → one RHS picker.
 * Channel → Lower + Upper bound pickers (both full operands).
 * Moving → numeric threshold + integer bars.
 */
function renderFamilyBody(
  leaf: RulesV2.LeafCondition,
  onChange: (next: RulesV2.LeafCondition) => void,
  indicators: IndicatorInstance[],
  knownStateKeys: KnownStateKeys,
  left: RulesV2.ConditionOperand,
): ReactNode {
  switch (leaf.family) {
    case RulesV2.LeafConditionFamily.Comparison:
    case RulesV2.LeafConditionFamily.Crossing:
    case RulesV2.LeafConditionFamily.State:
      return (
        <Box flexGrow="1" minWidth="180px">
          <Text as="div" size="1" color="gray" mb="1">
            Value
          </Text>
          <OperandPickerV2
            value={leaf.right}
            onChange={(next) => onChange({ ...leaf, right: next })}
            indicators={indicators}
            symbolStateKeys={knownStateKeys.symbol}
            globalStateKeys={knownStateKeys.global}
            literalValueType={literalTypeForRhs(left)}
            ariaLabel="Right operand kind"
          />
        </Box>
      );
    case RulesV2.LeafConditionFamily.Channel:
      return (
        <>
          <Box flexGrow="1" minWidth="180px">
            <Text as="div" size="1" color="gray" mb="1">
              Upper
            </Text>
            <OperandPickerV2
              value={leaf.upper}
              onChange={(next) => onChange({ ...leaf, upper: next })}
              indicators={indicators}
              symbolStateKeys={knownStateKeys.symbol}
              globalStateKeys={knownStateKeys.global}
              literalValueType={literalTypeForRhs(left)}
              ariaLabel="Upper bound operand kind"
            />
          </Box>
          <Box flexGrow="1" minWidth="180px">
            <Text as="div" size="1" color="gray" mb="1">
              Lower
            </Text>
            <OperandPickerV2
              value={leaf.lower}
              onChange={(next) => onChange({ ...leaf, lower: next })}
              indicators={indicators}
              symbolStateKeys={knownStateKeys.symbol}
              globalStateKeys={knownStateKeys.global}
              literalValueType={literalTypeForRhs(left)}
              ariaLabel="Lower bound operand kind"
            />
          </Box>
        </>
      );
    case RulesV2.LeafConditionFamily.Moving:
      return (
        <Flex direction="column" gap="2">
          <Flex gap="2" align="center">
            <TextField.Root
              aria-label="Moving threshold"
              type="number"
              step="any"
              value={leaf.threshold}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                onChange({ ...leaf, threshold: Number.isFinite(parsed) ? parsed : 0 });
              }}
            />
            <Text size="2" color="gray">
              {isPercentMoving(leaf.operator) ? '%' : ''}
            </Text>
          </Flex>
          <Flex gap="2" align="center">
            <Text size="2" color="gray">
              in
            </Text>
            <TextField.Root
              aria-label="Moving lookback bars"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={leaf.lookbackBars}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                onChange({
                  ...leaf,
                  lookbackBars: Number.isFinite(parsed) && parsed > 0 ? parsed : 1,
                });
              }}
            />
            <Text size="2" color="gray">
              bars
            </Text>
          </Flex>
        </Flex>
      );
  }
}

/**
 * Update the leaf when the LHS changes — re-derives the RHS literal type so the
 * input control stays in sync and re-shapes the leaf if the new LHS would
 * make the current operator illegal.
 */
function updateLeft(
  leaf: RulesV2.LeafCondition,
  next: RulesV2.ConditionOperand,
): RulesV2.LeafCondition {
  const legalOperators = legalOperatorsFor(next);
  const stillLegal = legalOperators.some((option) => option.value === leaf.operator);
  if (stillLegal) {
    const updated = { ...leaf, left: next };
    return retypeLiterals(updated);
  }
  // Switch to a default operator for the new LHS so the leaf stays valid.
  const fallback = legalOperators[0] ?? OPERATOR_OPTIONS[0];
  if (!fallback) return { ...leaf, left: next };
  return retypeLiterals(buildLeafForOperator(leaf, next, fallback.value, fallback.family));
}

/**
 * Walk every literal slot on the leaf and re-type it to the LHS's value type.
 *
 * Keeps the RHS literal input control matching the LHS after the user flips
 * to a new operand kind (numeric → bool, etc.).
 */
function retypeLiterals(leaf: RulesV2.LeafCondition): RulesV2.LeafCondition {
  const type = literalTypeForRhs(leaf.left);
  if (leaf.family === RulesV2.LeafConditionFamily.Channel) {
    return {
      ...leaf,
      upper: retypeLiteralOperand(leaf.upper, type),
      lower: retypeLiteralOperand(leaf.lower, type),
    };
  }
  if (
    leaf.family === RulesV2.LeafConditionFamily.Comparison ||
    leaf.family === RulesV2.LeafConditionFamily.Crossing ||
    leaf.family === RulesV2.LeafConditionFamily.State
  ) {
    return { ...leaf, right: retypeLiteralOperand(leaf.right, type) };
  }
  return leaf;
}

/**
 * If an operand is a `Literal`, re-type it to `type`. Other operand kinds pass
 * through untouched.
 */
function retypeLiteralOperand(
  operand: RulesV2.ConditionOperand,
  type: StateValueType,
): RulesV2.ConditionOperand {
  if (operand.kind !== RulesV2.OperandKind.Literal) return operand;
  if (operand.value.type === type) return operand;
  switch (type) {
    case StateValueType.Number:
      return { kind: RulesV2.OperandKind.Literal, value: { type, value: 0 } };
    case StateValueType.Bool:
      return { kind: RulesV2.OperandKind.Literal, value: { type, value: false } };
    case StateValueType.String:
    case StateValueType.Enum:
      return { kind: RulesV2.OperandKind.Literal, value: { type, value: '' } };
  }
}

/**
 * Build a fresh leaf for a new operator, given the previous leaf + a new
 * operator + family.
 *
 * Carries `interval` across the change and seeds the family-specific shape
 * (binary / ternary / unary+tuple) with sensible defaults.
 */
export function buildLeafForOperator(
  prev: RulesV2.LeafCondition,
  left: RulesV2.ConditionOperand,
  operator: RulesV2.Operator,
  family: RulesV2.LeafConditionFamily,
): RulesV2.LeafCondition {
  const interval = prev.interval;
  const rhsType = literalTypeForRhs(left);
  switch (family) {
    case RulesV2.LeafConditionFamily.Comparison:
      return {
        family,
        operator: operator as RulesV2.ComparisonOperator,
        left,
        right: defaultLiteral(rhsType),
        interval,
      };
    case RulesV2.LeafConditionFamily.Crossing:
      return {
        family,
        operator: operator as RulesV2.CrossingOperator,
        left,
        right: defaultLiteral(rhsType),
        interval,
      };
    case RulesV2.LeafConditionFamily.State:
      return {
        family,
        operator: operator as RulesV2.StateOperator,
        left,
        right: defaultLiteral(rhsType),
        interval,
      };
    case RulesV2.LeafConditionFamily.Channel:
      return {
        family,
        operator: operator as RulesV2.ChannelOperator,
        left,
        upper: defaultLiteral(rhsType),
        lower: defaultLiteral(rhsType),
        interval,
      };
    case RulesV2.LeafConditionFamily.Moving:
      return {
        family,
        operator: operator as RulesV2.MovingOperator,
        left,
        threshold: 0,
        lookbackBars: 1,
        interval,
      };
  }
}

/**
 * Switch a leaf to a new operator. When the operator stays in the same family
 * the only change is `operator`; when the family changes the leaf is rebuilt
 * via {@link buildLeafForOperator}.
 */
function changeOperator(
  leaf: RulesV2.LeafCondition,
  operator: RulesV2.Operator,
  family: RulesV2.LeafConditionFamily,
): RulesV2.LeafCondition {
  if (leaf.family === family) {
    return { ...leaf, operator } as RulesV2.LeafCondition;
  }
  return buildLeafForOperator(leaf, leaf.left, operator, family);
}

/**
 * Build a literal operand of the given `StateValueType` with a sensible default
 * value.
 */
function defaultLiteral(type: StateValueType): RulesV2.ConditionOperand {
  switch (type) {
    case StateValueType.Number:
      return { kind: RulesV2.OperandKind.Literal, value: { type, value: 0 } };
    case StateValueType.Bool:
      return { kind: RulesV2.OperandKind.Literal, value: { type, value: false } };
    case StateValueType.String:
    case StateValueType.Enum:
      return { kind: RulesV2.OperandKind.Literal, value: { type, value: '' } };
  }
}

/**
 * Pick the literal type the RHS should render with, derived from the LHS.
 *
 * Mirrors {@link operandValueKind} but in `StateValueType` terms.
 * `Numeric` LHS → `Number`; `Bool` LHS → `Bool`; string-like LHS → `String`;
 * unknown → `Number` (the most common case).
 */
function literalTypeForRhs(left: RulesV2.ConditionOperand): StateValueType {
  switch (operandValueKind(left)) {
    case OperandValueKind.Numeric:
      return StateValueType.Number;
    case OperandValueKind.Bool:
      return StateValueType.Bool;
    case OperandValueKind.StringLike:
      return StateValueType.String;
    case OperandValueKind.Unknown:
      return StateValueType.Number;
  }
}

/** Whether a moving operator is a percent variant (vs absolute). */
function isPercentMoving(operator: RulesV2.MovingOperator): boolean {
  return (
    operator === RulesV2.MovingOperator.MovingUpPercent ||
    operator === RulesV2.MovingOperator.MovingDownPercent
  );
}

/**
 * Whether the leaf needs the `Interval` row at all.
 *
 * Any OHLCV or `IndicatorRef` operand on any slot forces interval.
 * Series-aware families (Crossing / Channel / Moving) always need it.
 */
export function needsInterval(leaf: RulesV2.LeafCondition): boolean {
  switch (leaf.family) {
    case RulesV2.LeafConditionFamily.Crossing:
      // Crossing only needs the row interval when the LHS or RHS itself does
      // (Price-vs-Literal crossing — Ex.1 in #396 — has no interval row).
      return operandNeedsInterval(leaf.left) || operandNeedsInterval(leaf.right);
    case RulesV2.LeafConditionFamily.Channel:
      // Channel always reads bounds against the LHS's series — surface the row
      // interval when any operand is OHLCV / IndicatorRef.
      return (
        operandNeedsInterval(leaf.left) ||
        operandNeedsInterval(leaf.upper) ||
        operandNeedsInterval(leaf.lower)
      );
    case RulesV2.LeafConditionFamily.Moving:
      // Moving operates on the LHS's native timeline; the interval is part of
      // the operator's contract (lookback-bars are bars of `interval`).
      return true;
    case RulesV2.LeafConditionFamily.Comparison:
    case RulesV2.LeafConditionFamily.State:
      return operandNeedsInterval(leaf.left) || operandNeedsInterval(leaf.right);
  }
}

/**
 * The `Interval` dropdown — picks one of the supported {@link Period}s.
 *
 * Lazy: this picker shows every period defined globally; a future tightening
 * would scope to the symbol's watched periods (which we'd need to thread
 * through from the rule scope).
 */
function IntervalPicker({
  value,
  onChange,
}: {
  value: Period | undefined;
  onChange: (next: Period) => void;
}): ReactNode {
  return (
    <Select.Root value={value} onValueChange={(next) => onChange(next as Period)}>
      <Select.Trigger placeholder="Pick a period" aria-label="Row interval" />
      <Select.Content>
        {Object.entries(PERIOD_LABELS).map(([period, label]) => (
          <Select.Item key={period} value={period}>
            {label}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

/**
 * Filter the indicator-instance list to the row's `interval` (per ADR 0016 —
 * "indicator binding is profile-attached, filtered by the row's interval").
 *
 * When the row has no interval yet, every instance is allowed so the user can
 * still pick one.
 */
function filterIndicatorsByPeriod(
  indicators: IndicatorInstance[],
  interval: Period | undefined,
  instancePeriods: InstancePeriods,
): IndicatorInstance[] {
  if (interval === undefined) return indicators;
  return indicators.filter((instance) => {
    const period = instancePeriods[instance.id];
    return period === undefined || period === interval;
  });
}

/**
 * Apply the bool-shortcut sugar when the leaf's LHS resolves to a Bool-typed
 * operand: persist the leaf as `State / Equals` against `Literal(true)`.
 *
 * Called by the editor's submit handler so the form's transient state survives
 * without that rewrite (the UI hides the operator + RHS rows in the meantime).
 */
export function applyBoolShortcut(leaf: RulesV2.LeafCondition): RulesV2.LeafCondition {
  if (!isBoolOperand(leaf.left)) return leaf;
  return {
    family: RulesV2.LeafConditionFamily.State,
    operator: RulesV2.StateOperator.Equals,
    left: leaf.left,
    right: {
      kind: RulesV2.OperandKind.Literal,
      value: { type: StateValueType.Bool, value: true },
    },
    interval: leaf.interval,
  };
}
