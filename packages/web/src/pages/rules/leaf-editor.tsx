import {
  type Action,
  ActionKind,
  type ChannelOperator,
  type ComparisonOperator,
  type ConditionOperand,
  type CrossingOperator,
  type IndicatorInstance,
  type LeafCondition,
  LeafConditionFamily,
  MovingOperator,
  OperandKind,
  type Operator,
  type Period,
  StateOperator,
  StateValueType,
} from '@lametrader/core';
import { Box, Flex, Select, Text, TextField } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { isBoolOperand, OperandValueKind, operandValueKind } from '../../lib/rule-form-schema.js';
import { OperandPicker, operandNeedsInterval } from './operand-picker.js';
import { legalOperatorsFor, OPERATOR_OPTIONS, OperatorPicker } from './operator-picker.js';
import { PERIOD_LABELS } from './trigger-picker.js';

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
 *
 * `priorActions` lets the RHS literal infer its type from a same-rule
 * `SetState` action that writes the same state key (per issue #428 item 8). The
 * editor doesn't know about action ordering across leaves; the full action list
 * is passed in and any matching `SetState` wins over the LHS's own `valueType`.
 */
export function LeafEditor({
  value,
  onChange,
  indicators,
  instancePeriods,
  knownStateKeys,
  priorActions = [],
}: {
  value: LeafCondition;
  onChange: (next: LeafCondition) => void;
  indicators: IndicatorInstance[];
  instancePeriods: InstancePeriods;
  knownStateKeys: KnownStateKeys;
  priorActions?: Action[];
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
          <OperandPicker
            value={left}
            onChange={(next) => onChange(updateLeft(value, next, priorActions))}
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
            <OperatorPicker
              value={value.operator}
              left={left}
              onChange={({ operator, family }) =>
                onChange(changeOperator(value, operator, family, priorActions))
              }
              ariaLabel="Operator"
            />
          </Box>
        )}
        {boolShortcut
          ? null
          : renderFamilyBody(
              value,
              onChange,
              visibleIndicators,
              knownStateKeys,
              left,
              priorActions,
            )}
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
  leaf: LeafCondition,
  onChange: (next: LeafCondition) => void,
  indicators: IndicatorInstance[],
  knownStateKeys: KnownStateKeys,
  left: ConditionOperand,
  priorActions: Action[],
): ReactNode {
  const rhsLiteralType = resolveRhsLiteralType(leaf, left, priorActions);
  switch (leaf.family) {
    case LeafConditionFamily.Comparison:
    case LeafConditionFamily.Crossing:
    case LeafConditionFamily.State:
      return (
        <Box flexGrow="1" minWidth="180px">
          <Text as="div" size="1" color="gray" mb="1">
            Value
          </Text>
          <OperandPicker
            value={leaf.right}
            onChange={(next) => onChange({ ...leaf, right: next })}
            indicators={indicators}
            symbolStateKeys={knownStateKeys.symbol}
            globalStateKeys={knownStateKeys.global}
            literalValueType={rhsLiteralType}
            ariaLabel="Right operand kind"
          />
        </Box>
      );
    case LeafConditionFamily.Channel:
      return (
        <>
          <Box flexGrow="1" minWidth="180px">
            <Text as="div" size="1" color="gray" mb="1">
              Upper
            </Text>
            <OperandPicker
              value={leaf.upper}
              onChange={(next) => onChange({ ...leaf, upper: next })}
              indicators={indicators}
              symbolStateKeys={knownStateKeys.symbol}
              globalStateKeys={knownStateKeys.global}
              literalValueType={rhsLiteralType}
              ariaLabel="Upper bound operand kind"
            />
          </Box>
          <Box flexGrow="1" minWidth="180px">
            <Text as="div" size="1" color="gray" mb="1">
              Lower
            </Text>
            <OperandPicker
              value={leaf.lower}
              onChange={(next) => onChange({ ...leaf, lower: next })}
              indicators={indicators}
              symbolStateKeys={knownStateKeys.symbol}
              globalStateKeys={knownStateKeys.global}
              literalValueType={rhsLiteralType}
              ariaLabel="Lower bound operand kind"
            />
          </Box>
        </>
      );
    case LeafConditionFamily.Moving:
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
  leaf: LeafCondition,
  next: ConditionOperand,
  priorActions: Action[],
): LeafCondition {
  const legalOperators = legalOperatorsFor(next);
  const stillLegal = legalOperators.some((option) => option.value === leaf.operator);
  if (stillLegal) {
    const updated = { ...leaf, left: next };
    return retypeLiterals(updated, priorActions);
  }
  // Switch to a default operator for the new LHS so the leaf stays valid.
  const fallback = legalOperators[0] ?? OPERATOR_OPTIONS[0];
  if (!fallback) return { ...leaf, left: next };
  return retypeLiterals(
    buildLeafForOperator(leaf, next, fallback.value, fallback.family),
    priorActions,
  );
}

/**
 * Walk every literal slot on the leaf and re-type it to the resolved RHS type.
 *
 * Keeps the RHS literal input control matching the LHS after the user flips
 * to a new operand kind (numeric → bool, etc.). When the LHS is a state ref
 * paired with `Equals`, the resolution honours a same-rule `SetState` action's
 * type for the matching key (per issue #428 item 8).
 */
function retypeLiterals(leaf: LeafCondition, priorActions: Action[]): LeafCondition {
  const type = resolveRhsLiteralType(leaf, leaf.left, priorActions);
  if (leaf.family === LeafConditionFamily.Channel) {
    return {
      ...leaf,
      upper: retypeLiteralOperand(leaf.upper, type),
      lower: retypeLiteralOperand(leaf.lower, type),
    };
  }
  if (
    leaf.family === LeafConditionFamily.Comparison ||
    leaf.family === LeafConditionFamily.Crossing ||
    leaf.family === LeafConditionFamily.State
  ) {
    return { ...leaf, right: retypeLiteralOperand(leaf.right, type) };
  }
  return leaf;
}

/**
 * If an operand is a `Literal`, re-type it to `type`. Other operand kinds pass
 * through untouched.
 */
function retypeLiteralOperand(operand: ConditionOperand, type: StateValueType): ConditionOperand {
  if (operand.kind !== OperandKind.Literal) return operand;
  if (operand.value.type === type) return operand;
  switch (type) {
    case StateValueType.Number:
      return { kind: OperandKind.Literal, value: { type, value: 0 } };
    case StateValueType.Bool:
      return { kind: OperandKind.Literal, value: { type, value: false } };
    case StateValueType.String:
    case StateValueType.Enum:
      return { kind: OperandKind.Literal, value: { type, value: '' } };
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
  prev: LeafCondition,
  left: ConditionOperand,
  operator: Operator,
  family: LeafConditionFamily,
): LeafCondition {
  const interval = prev.interval;
  const rhsType = literalTypeForRhs(left);
  switch (family) {
    case LeafConditionFamily.Comparison:
      return {
        family,
        operator: operator as ComparisonOperator,
        left,
        right: defaultLiteral(rhsType),
        interval,
      };
    case LeafConditionFamily.Crossing:
      return {
        family,
        operator: operator as CrossingOperator,
        left,
        right: defaultLiteral(rhsType),
        interval,
      };
    case LeafConditionFamily.State:
      return {
        family,
        operator: operator as StateOperator,
        left,
        right: defaultLiteral(rhsType),
        interval,
      };
    case LeafConditionFamily.Channel:
      return {
        family,
        operator: operator as ChannelOperator,
        left,
        upper: defaultLiteral(rhsType),
        lower: defaultLiteral(rhsType),
        interval,
      };
    case LeafConditionFamily.Moving:
      return {
        family,
        operator: operator as MovingOperator,
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
 * via {@link buildLeafForOperator} and re-typed against `priorActions`.
 */
function changeOperator(
  leaf: LeafCondition,
  operator: Operator,
  family: LeafConditionFamily,
  priorActions: Action[],
): LeafCondition {
  if (leaf.family === family) {
    return { ...leaf, operator } as LeafCondition;
  }
  return retypeLiterals(buildLeafForOperator(leaf, leaf.left, operator, family), priorActions);
}

/**
 * Build a literal operand of the given `StateValueType` with a sensible default
 * value.
 */
function defaultLiteral(type: StateValueType): ConditionOperand {
  switch (type) {
    case StateValueType.Number:
      return { kind: OperandKind.Literal, value: { type, value: 0 } };
    case StateValueType.Bool:
      return { kind: OperandKind.Literal, value: { type, value: false } };
    case StateValueType.String:
    case StateValueType.Enum:
      return { kind: OperandKind.Literal, value: { type, value: '' } };
  }
}

/**
 * Pick the literal type the RHS should render with, derived from the LHS.
 *
 * Mirrors {@link operandValueKind} but in `StateValueType` terms.
 * `Numeric` LHS → `Number`; `Bool` LHS → `Bool`; string-like LHS → `String`;
 * unknown → `Number` (the most common case).
 */
function literalTypeForRhs(left: ConditionOperand): StateValueType {
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

/**
 * Resolve the RHS literal {@link StateValueType} for a leaf.
 *
 * The base resolution comes from the LHS operand's value type
 * ({@link literalTypeForRhs}). Per issue #428 item 8, when the LHS is a
 * `SymbolStateRef` / `GlobalStateRef` paired with an `Equals` operator (the
 * Comparison or State family), a same-rule `SetState` action targeting the
 * same key takes precedence — its `value.type` is what the user just declared
 * for that key, so the RHS picker honours it over the LHS's own valueType.
 *
 * The override scope is intentionally narrow: only state-ref LHS + Equals
 * (Comparison or State family). Other families don't take a Literal RHS in a
 * way that benefits from cross-action typing.
 */
export function resolveRhsLiteralType(
  leaf: LeafCondition,
  left: ConditionOperand,
  priorActions: Action[],
): StateValueType {
  const base = literalTypeForRhs(left);
  const equalsOp = isEqualsOperator(leaf);
  if (!equalsOp) return base;
  if (left.kind === OperandKind.SymbolStateRef) {
    const fromAction = findSetStateType(priorActions, ActionKind.SetSymbolState, left.key);
    return fromAction ?? base;
  }
  if (left.kind === OperandKind.GlobalStateRef) {
    const fromAction = findSetStateType(priorActions, ActionKind.SetGlobalState, left.key);
    return fromAction ?? base;
  }
  return base;
}

/**
 * Whether the leaf carries the cross-family `Equals` operator (Comparison's
 * `Eq` or State's `Equals`).
 *
 * The state-typed-RHS override only fires for these two operator dialects
 * (see {@link resolveRhsLiteralType}).
 */
function isEqualsOperator(leaf: LeafCondition): boolean {
  if (leaf.family === LeafConditionFamily.State) {
    return leaf.operator === StateOperator.Equals;
  }
  if (leaf.family === LeafConditionFamily.Comparison) {
    // Cast through string to compare without re-importing ComparisonOperator.Eq
    // (the type is already constrained to ComparisonOperator on Comparison leaves).
    return (leaf.operator as string) === 'eq';
  }
  return false;
}

/**
 * Find the {@link StateValueType} a same-rule {@link Action} writes to a state
 * key, or `undefined` if no such action exists.
 *
 * Used by {@link resolveRhsLiteralType} so the RHS literal input adapts to the
 * type the user just declared in a `SetState` action targeting the same key.
 */
function findSetStateType(
  actions: Action[],
  kind: ActionKind.SetSymbolState | ActionKind.SetGlobalState,
  key: string,
): StateValueType | undefined {
  if (key === '') return undefined;
  for (const action of actions) {
    if (action.kind === kind && action.key === key) return action.value.type;
  }
  return undefined;
}

/** Whether a moving operator is a percent variant (vs absolute). */
function isPercentMoving(operator: MovingOperator): boolean {
  return (
    operator === MovingOperator.MovingUpPercent || operator === MovingOperator.MovingDownPercent
  );
}

/**
 * Whether the leaf needs the `Interval` row at all.
 *
 * Any OHLCV or `IndicatorRef` operand on any slot forces interval.
 * Series-aware families (Crossing / Channel / Moving) always need it.
 */
export function needsInterval(leaf: LeafCondition): boolean {
  switch (leaf.family) {
    case LeafConditionFamily.Crossing:
      // Crossing only needs the row interval when the LHS or RHS itself does
      // (Price-vs-Literal crossing — Ex.1 in #396 — has no interval row).
      return operandNeedsInterval(leaf.left) || operandNeedsInterval(leaf.right);
    case LeafConditionFamily.Channel:
      // Channel always reads bounds against the LHS's series — surface the row
      // interval when any operand is OHLCV / IndicatorRef.
      return (
        operandNeedsInterval(leaf.left) ||
        operandNeedsInterval(leaf.upper) ||
        operandNeedsInterval(leaf.lower)
      );
    case LeafConditionFamily.Moving:
      // Moving operates on the LHS's native timeline; the interval is part of
      // the operator's contract (lookback-bars are bars of `interval`).
      return true;
    case LeafConditionFamily.Comparison:
    case LeafConditionFamily.State:
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
export function applyBoolShortcut(leaf: LeafCondition): LeafCondition {
  if (!isBoolOperand(leaf.left)) return leaf;
  return {
    family: LeafConditionFamily.State,
    operator: StateOperator.Equals,
    left: leaf.left,
    right: {
      kind: OperandKind.Literal,
      value: { type: StateValueType.Bool, value: true },
    },
    interval: leaf.interval,
  };
}
