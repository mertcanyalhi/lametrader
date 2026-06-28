import {
  type IndicatorInstance,
  type Period,
  RulesV2,
  type StateValue,
  StateValueType,
} from '@lametrader/core';
import { Badge, Box, Flex, Select, Switch, Text, TextField } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { useProfileGlobalState, useProfileSymbolState } from '../../lib/hooks/state.js';

/**
 * A controlled picker for one v2 condition-leaf operand. Renders the kind
 * dropdown plus the per-kind inner inputs:
 *
 * - `Price` (replaces v1 `Current`) / OHLCV — no inner inputs.
 * - `IndicatorRef` — instance + state-key + value-type. The instance dropdown
 *   filters by the leaf's `interval` so only indicators on that period appear.
 * - `SymbolStateRef` / `GlobalStateRef` — freetext key + a list of suggested
 *   keys from the matching `GET /symbols/:id/state` / `GET
 *   /profiles/:profileId/state/global` endpoint (click to fill).
 * - `Literal` — value-type + a value editor that adapts to the type
 *   (number / text / switch).
 */
export function OperandPickerV2({
  value,
  onChange,
  indicators,
  interval,
  profileId,
  symbolId,
  ariaLabel,
  inlineError,
}: {
  value: RulesV2.ConditionOperand;
  onChange: (next: RulesV2.ConditionOperand) => void;
  /** Profile-attached indicator instances (drives the IndicatorRef dropdown). */
  indicators: IndicatorInstance[];
  /** The owning leaf's `interval`; filters IndicatorRef options to instances on that period. */
  interval: Period | undefined;
  /** The current profile id — used to fetch state-key suggestions for state refs. */
  profileId: string | undefined;
  /** The leaf's owning symbol (when scope is `Symbol`); used for SymbolStateRef suggestions. */
  symbolId: string | undefined;
  /** Accessible name prefix for inner controls — keeps left vs right operand pickers distinct. */
  ariaLabel: string;
  /** Optional inline validation message surfaced from the API `{ fields[] }` envelope. */
  inlineError?: string;
}): ReactNode {
  return (
    <Flex direction="column" gap="2">
      <Select.Root
        value={value.kind}
        onValueChange={(next) =>
          onChange(operandV2FromKind(next as RulesV2.OperandKind, value, indicators, interval))
        }
      >
        <Select.Trigger aria-label={`${ariaLabel} kind`} />
        <Select.Content>
          <Select.Group>
            <Select.Label>Bar / quote</Select.Label>
            <Select.Item value={RulesV2.OperandKind.Price}>Price</Select.Item>
            <Select.Item value={RulesV2.OperandKind.Open}>Open</Select.Item>
            <Select.Item value={RulesV2.OperandKind.High}>High</Select.Item>
            <Select.Item value={RulesV2.OperandKind.Low}>Low</Select.Item>
            <Select.Item value={RulesV2.OperandKind.Close}>Close</Select.Item>
            <Select.Item value={RulesV2.OperandKind.Volume}>Volume</Select.Item>
          </Select.Group>
          <Select.Group>
            <Select.Label>Reference</Select.Label>
            <Select.Item value={RulesV2.OperandKind.IndicatorRef}>Indicator</Select.Item>
            <Select.Item value={RulesV2.OperandKind.SymbolStateRef}>Symbol state</Select.Item>
            <Select.Item value={RulesV2.OperandKind.GlobalStateRef}>Global state</Select.Item>
          </Select.Group>
          <Select.Group>
            <Select.Label>Constant</Select.Label>
            <Select.Item value={RulesV2.OperandKind.Literal}>Literal</Select.Item>
          </Select.Group>
        </Select.Content>
      </Select.Root>
      <Detail
        value={value}
        onChange={onChange}
        indicators={indicators}
        interval={interval}
        profileId={profileId}
        symbolId={symbolId}
        ariaLabel={ariaLabel}
      />
      {inlineError ? (
        <Text role="alert" color="red" size="1">
          {inlineError}
        </Text>
      ) : null}
    </Flex>
  );
}

/** The per-kind inner editor — rendered as a sibling of the kind dropdown. */
function Detail({
  value,
  onChange,
  indicators,
  interval,
  profileId,
  symbolId,
  ariaLabel,
}: {
  value: RulesV2.ConditionOperand;
  onChange: (next: RulesV2.ConditionOperand) => void;
  indicators: IndicatorInstance[];
  interval: Period | undefined;
  profileId: string | undefined;
  symbolId: string | undefined;
  ariaLabel: string;
}): ReactNode {
  switch (value.kind) {
    case RulesV2.OperandKind.Price:
    case RulesV2.OperandKind.Open:
    case RulesV2.OperandKind.High:
    case RulesV2.OperandKind.Low:
    case RulesV2.OperandKind.Close:
    case RulesV2.OperandKind.Volume:
      return null;
    case RulesV2.OperandKind.IndicatorRef: {
      // Indicator instances run at every watched period of the parent symbol
      // (per packages/core/src/profile.types.ts comment), so the row's
      // `interval` does not filter the instance list — every attached instance
      // is valid at every period. `interval` is kept on the leaf so the engine
      // picks the right period's reading at evaluation time.
      void interval;
      return (
        <Flex direction="column" gap="2">
          <Select.Root
            value={value.instanceId === '' ? undefined : value.instanceId}
            onValueChange={(next) => onChange({ ...value, instanceId: next })}
          >
            <Select.Trigger placeholder="Pick an indicator" aria-label={`${ariaLabel} indicator`} />
            <Select.Content>
              {indicators.map((instance) => (
                <Select.Item key={instance.id} value={instance.id}>
                  {instance.summary ?? instance.label ?? instance.indicatorKey}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <TextField.Root
            placeholder="State key"
            aria-label={`${ariaLabel} state key`}
            value={value.stateKey}
            onChange={(event) => onChange({ ...value, stateKey: event.target.value })}
          />
          <ValueTypeSelect
            value={value.valueType}
            onChange={(valueType) => onChange({ ...value, valueType })}
            ariaLabel={`${ariaLabel} value type`}
          />
        </Flex>
      );
    }
    case RulesV2.OperandKind.SymbolStateRef:
      return (
        <StateKeyDetail
          kind="symbol"
          value={value}
          onChange={onChange}
          profileId={profileId}
          symbolId={symbolId}
          ariaLabel={ariaLabel}
        />
      );
    case RulesV2.OperandKind.GlobalStateRef:
      return (
        <StateKeyDetail
          kind="global"
          value={value}
          onChange={onChange}
          profileId={profileId}
          symbolId={symbolId}
          ariaLabel={ariaLabel}
        />
      );
    case RulesV2.OperandKind.Literal:
      return (
        <Flex direction="column" gap="2">
          <ValueTypeSelect
            value={value.value.type}
            onChange={(valueType) =>
              onChange({ kind: RulesV2.OperandKind.Literal, value: defaultLiteralValue(valueType) })
            }
            ariaLabel={`${ariaLabel} value type`}
          />
          <LiteralValueEditor
            value={value.value}
            onChange={(next) => onChange({ kind: RulesV2.OperandKind.Literal, value: next })}
            ariaLabel={`${ariaLabel} value`}
          />
        </Flex>
      );
  }
}

/**
 * Inner editor for a SymbolStateRef / GlobalStateRef operand — a freetext key
 * input plus a row of "known key" chips seeded from the matching state
 * endpoint (click to fill). The freetext input is the source of truth for the
 * value; chips are a convenience shortcut.
 */
function StateKeyDetail({
  kind,
  value,
  onChange,
  profileId,
  symbolId,
  ariaLabel,
}: {
  kind: 'symbol' | 'global';
  value: Extract<
    RulesV2.ConditionOperand,
    { kind: RulesV2.OperandKind.SymbolStateRef | RulesV2.OperandKind.GlobalStateRef }
  >;
  onChange: (next: RulesV2.ConditionOperand) => void;
  profileId: string | undefined;
  symbolId: string | undefined;
  ariaLabel: string;
}): ReactNode {
  const symbolQuery = useProfileSymbolState(
    kind === 'symbol' ? profileId : undefined,
    kind === 'symbol' ? symbolId : undefined,
  );
  const globalQuery = useProfileGlobalState(kind === 'global' ? profileId : undefined);
  const suggested = Object.keys(
    (kind === 'symbol' ? symbolQuery.data : globalQuery.data) ?? {},
  ).sort();
  return (
    <Flex direction="column" gap="2">
      <TextField.Root
        placeholder="State key"
        aria-label={`${ariaLabel} state key`}
        value={value.key}
        onChange={(event) => onChange({ ...value, key: event.target.value })}
      />
      {suggested.length > 0 ? (
        <Flex gap="1" wrap="wrap" aria-label={`${ariaLabel} suggested keys`} role="group">
          {suggested.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onChange({ ...value, key })}
              className="cursor-pointer"
              aria-label={`Use ${key}`}
            >
              <Badge color="gray" variant="soft" size="1">
                {key}
              </Badge>
            </button>
          ))}
        </Flex>
      ) : null}
      <ValueTypeSelect
        value={value.valueType}
        onChange={(valueType) => onChange({ ...value, valueType })}
        ariaLabel={`${ariaLabel} value type`}
      />
    </Flex>
  );
}

/** The shared `StateValueType` dropdown used by ref + literal details. */
function ValueTypeSelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: StateValueType;
  onChange: (next: StateValueType) => void;
  ariaLabel: string;
}): ReactNode {
  return (
    <Select.Root value={value} onValueChange={(next) => onChange(next as StateValueType)}>
      <Select.Trigger aria-label={ariaLabel} />
      <Select.Content>
        <Select.Item value={StateValueType.Number}>Number</Select.Item>
        <Select.Item value={StateValueType.String}>String</Select.Item>
        <Select.Item value={StateValueType.Bool}>Boolean</Select.Item>
        <Select.Item value={StateValueType.Enum}>Enum</Select.Item>
      </Select.Content>
    </Select.Root>
  );
}

/** Inline editor for a {@link StateValue} literal — adapts to the value's `type`. */
function LiteralValueEditor({
  value,
  onChange,
  ariaLabel,
}: {
  value: StateValue;
  onChange: (next: StateValue) => void;
  ariaLabel: string;
}): ReactNode {
  switch (value.type) {
    case StateValueType.Number:
      return (
        <TextField.Root
          aria-label={ariaLabel}
          type="number"
          value={Number.isNaN(value.value) ? '' : String(value.value)}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            onChange({ type: StateValueType.Number, value: Number.isFinite(parsed) ? parsed : 0 });
          }}
        />
      );
    case StateValueType.Bool:
      return (
        <Box>
          <Switch
            aria-label={ariaLabel}
            checked={value.value}
            onCheckedChange={(checked) =>
              onChange({ type: StateValueType.Bool, value: checked === true })
            }
          />
        </Box>
      );
    case StateValueType.String:
    case StateValueType.Enum:
      return (
        <TextField.Root
          aria-label={ariaLabel}
          value={value.value}
          onChange={(event) => onChange({ type: value.type, value: event.target.value })}
        />
      );
  }
}

/**
 * Build a fresh operand from a target kind, preserving any reusable fields
 * carried by the previous operand (so flipping kinds doesn't blow away a
 * partially-entered state key, for example).
 */
function operandV2FromKind(
  kind: RulesV2.OperandKind,
  previous: RulesV2.ConditionOperand,
  indicators: IndicatorInstance[],
  interval: Period | undefined,
): RulesV2.ConditionOperand {
  switch (kind) {
    case RulesV2.OperandKind.Price:
    case RulesV2.OperandKind.Open:
    case RulesV2.OperandKind.High:
    case RulesV2.OperandKind.Low:
    case RulesV2.OperandKind.Close:
    case RulesV2.OperandKind.Volume:
      return { kind };
    case RulesV2.OperandKind.IndicatorRef: {
      void interval;
      const carryInstanceId =
        previous.kind === RulesV2.OperandKind.IndicatorRef
          ? previous.instanceId
          : (indicators[0]?.id ?? '');
      const carryStateKey =
        previous.kind === RulesV2.OperandKind.IndicatorRef ? previous.stateKey : '';
      const carryValueType = carryValueTypeFrom(previous);
      return {
        kind: RulesV2.OperandKind.IndicatorRef,
        instanceId: carryInstanceId,
        stateKey: carryStateKey,
        valueType: carryValueType,
      };
    }
    case RulesV2.OperandKind.SymbolStateRef:
    case RulesV2.OperandKind.GlobalStateRef: {
      const carryKey =
        previous.kind === RulesV2.OperandKind.SymbolStateRef ||
        previous.kind === RulesV2.OperandKind.GlobalStateRef
          ? previous.key
          : '';
      const carryValueType = carryValueTypeFrom(previous);
      return { kind, key: carryKey, valueType: carryValueType };
    }
    case RulesV2.OperandKind.Literal:
      return {
        kind: RulesV2.OperandKind.Literal,
        value:
          previous.kind === RulesV2.OperandKind.Literal
            ? previous.value
            : defaultLiteralValue(carryValueTypeFrom(previous)),
      };
  }
}

/** Best-effort carry of a previous operand's value type when switching kinds. */
function carryValueTypeFrom(previous: RulesV2.ConditionOperand): StateValueType {
  if (previous.kind === RulesV2.OperandKind.Literal) return previous.value.type;
  if (
    previous.kind === RulesV2.OperandKind.IndicatorRef ||
    previous.kind === RulesV2.OperandKind.SymbolStateRef ||
    previous.kind === RulesV2.OperandKind.GlobalStateRef
  ) {
    return previous.valueType;
  }
  return StateValueType.Number;
}

/** A neutral starter literal value for a given type. */
function defaultLiteralValue(type: StateValueType): StateValue {
  switch (type) {
    case StateValueType.Number:
      return { type: StateValueType.Number, value: 0 };
    case StateValueType.Bool:
      return { type: StateValueType.Bool, value: false };
    case StateValueType.Enum:
      return { type: StateValueType.Enum, value: '' };
    case StateValueType.String:
      return { type: StateValueType.String, value: '' };
  }
}

/**
 * Resolve the value type an operand "produces" — used by the operator picker
 * to filter operators to those legal for both sides of a leaf.
 *
 * - OHLCV / Price → Number.
 * - IndicatorRef / SymbolStateRef / GlobalStateRef → the operand's declared `valueType`.
 * - Literal → the literal's `type`.
 */
export function operandV2ValueType(operand: RulesV2.ConditionOperand): StateValueType {
  switch (operand.kind) {
    case RulesV2.OperandKind.Price:
    case RulesV2.OperandKind.Open:
    case RulesV2.OperandKind.High:
    case RulesV2.OperandKind.Low:
    case RulesV2.OperandKind.Close:
    case RulesV2.OperandKind.Volume:
      return StateValueType.Number;
    case RulesV2.OperandKind.IndicatorRef:
    case RulesV2.OperandKind.SymbolStateRef:
    case RulesV2.OperandKind.GlobalStateRef:
      return operand.valueType;
    case RulesV2.OperandKind.Literal:
      return operand.value.type;
  }
}
