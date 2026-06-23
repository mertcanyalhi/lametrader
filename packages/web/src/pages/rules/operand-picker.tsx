import {
  type ConditionOperand,
  type IndicatorInstance,
  OperandKind,
  StateValueType,
} from '@lametrader/core';
import { Box, Flex, Select, Switch, Text, TextField } from '@radix-ui/themes';
import type { ReactNode } from 'react';

/**
 * A controlled picker for a single condition-leaf operand. Renders the kind
 * dropdown plus the per-kind inner inputs (indicator instance + state key,
 * state key name, literal value typed by kind).
 *
 * Lazy:
 * - State-key inputs are plain text inputs — the "autocomplete from current
 *   state when available" branch of #170 lands when a per-symbol state hook
 *   exists in the web package.
 *
 * @param value      - The current operand.
 * @param onChange   - Receives the next operand on any edit.
 * @param indicators - Profile-attached indicator instances (drives the
 *                     IndicatorRef instance dropdown). Empty list when no
 *                     profile is loaded or it has no attachments.
 * @param ariaLabel  - Accessible name for the kind dropdown (e.g. "Left
 *                     operand kind") — keeps the left and right pickers
 *                     distinguishable in tests.
 */
export function OperandPicker({
  value,
  onChange,
  indicators,
  ariaLabel,
}: {
  value: ConditionOperand;
  onChange: (next: ConditionOperand) => void;
  indicators: IndicatorInstance[];
  ariaLabel: string;
}): ReactNode {
  return (
    <Flex direction="column" gap="2">
      <Select.Root
        value={value.kind}
        onValueChange={(next) => onChange(operandFromKind(next as OperandKind, value, indicators))}
      >
        <Select.Trigger aria-label={ariaLabel} />
        <Select.Content>
          <Select.Group>
            <Select.Label>Bar / quote</Select.Label>
            <Select.Item value={OperandKind.CurrentValue}>Current</Select.Item>
            <Select.Item value={OperandKind.OpenValue}>Open</Select.Item>
            <Select.Item value={OperandKind.HighValue}>High</Select.Item>
            <Select.Item value={OperandKind.LowValue}>Low</Select.Item>
            <Select.Item value={OperandKind.CloseValue}>Close</Select.Item>
            <Select.Item value={OperandKind.VolumeValue}>Volume</Select.Item>
          </Select.Group>
          <Select.Group>
            <Select.Label>Reference</Select.Label>
            <Select.Item value={OperandKind.IndicatorRef}>Indicator</Select.Item>
            <Select.Item value={OperandKind.SymbolStateRef}>Symbol state</Select.Item>
            <Select.Item value={OperandKind.GlobalStateRef}>Global state</Select.Item>
          </Select.Group>
          <Select.Group>
            <Select.Label>Constant</Select.Label>
            <Select.Item value={OperandKind.Literal}>Literal</Select.Item>
          </Select.Group>
        </Select.Content>
      </Select.Root>
      <Detail value={value} onChange={onChange} indicators={indicators} ariaLabel={ariaLabel} />
    </Flex>
  );
}

/** The per-kind inner editor — rendered as a sibling of the kind dropdown. */
function Detail({
  value,
  onChange,
  indicators,
  ariaLabel,
}: {
  value: ConditionOperand;
  onChange: (next: ConditionOperand) => void;
  indicators: IndicatorInstance[];
  ariaLabel: string;
}): ReactNode {
  switch (value.kind) {
    case OperandKind.CurrentValue:
    case OperandKind.OpenValue:
    case OperandKind.HighValue:
    case OperandKind.LowValue:
    case OperandKind.CloseValue:
    case OperandKind.VolumeValue:
      return null;
    case OperandKind.IndicatorRef:
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
    case OperandKind.SymbolStateRef:
    case OperandKind.GlobalStateRef:
      return (
        <Flex direction="column" gap="2">
          <TextField.Root
            placeholder="State key"
            aria-label={`${ariaLabel} state key`}
            value={value.key}
            onChange={(event) => onChange({ ...value, key: event.target.value })}
          />
          <ValueTypeSelect
            value={value.valueType}
            onChange={(valueType) => onChange({ ...value, valueType })}
            ariaLabel={`${ariaLabel} value type`}
          />
        </Flex>
      );
    case OperandKind.Literal:
      return (
        <Flex direction="column" gap="2">
          <ValueTypeSelect
            value={value.value.type}
            onChange={(valueType) =>
              onChange({ kind: OperandKind.Literal, value: defaultLiteralValue(valueType) })
            }
            ariaLabel={`${ariaLabel} value type`}
          />
          <LiteralValueEditor
            value={value.value}
            onChange={(next) => onChange({ kind: OperandKind.Literal, value: next })}
            ariaLabel={`${ariaLabel} value`}
          />
        </Flex>
      );
  }
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

/**
 * Inline editor for a {@link StateValue} literal — its input adapts to the
 * value's `type` (number / text / switch).
 */
function LiteralValueEditor({
  value,
  onChange,
  ariaLabel,
}: {
  value:
    | { type: StateValueType.String; value: string }
    | { type: StateValueType.Number; value: number }
    | { type: StateValueType.Bool; value: boolean }
    | { type: StateValueType.Enum; value: string };
  onChange: (
    next:
      | { type: StateValueType.String; value: string }
      | { type: StateValueType.Number; value: number }
      | { type: StateValueType.Bool; value: boolean }
      | { type: StateValueType.Enum; value: string },
  ) => void;
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
function operandFromKind(
  kind: OperandKind,
  previous: ConditionOperand,
  indicators: IndicatorInstance[],
): ConditionOperand {
  switch (kind) {
    case OperandKind.CurrentValue:
    case OperandKind.OpenValue:
    case OperandKind.HighValue:
    case OperandKind.LowValue:
    case OperandKind.CloseValue:
    case OperandKind.VolumeValue:
      return { kind, valueType: StateValueType.Number };
    case OperandKind.IndicatorRef: {
      const carryInstanceId =
        previous.kind === OperandKind.IndicatorRef
          ? previous.instanceId
          : (indicators[0]?.id ?? '');
      const carryStateKey = previous.kind === OperandKind.IndicatorRef ? previous.stateKey : '';
      const carryValueType = carryValueTypeFrom(previous);
      return {
        kind: OperandKind.IndicatorRef,
        instanceId: carryInstanceId,
        stateKey: carryStateKey,
        valueType: carryValueType,
      };
    }
    case OperandKind.SymbolStateRef:
    case OperandKind.GlobalStateRef: {
      const carryKey =
        previous.kind === OperandKind.SymbolStateRef || previous.kind === OperandKind.GlobalStateRef
          ? previous.key
          : '';
      const carryValueType = carryValueTypeFrom(previous);
      return { kind, key: carryKey, valueType: carryValueType };
    }
    case OperandKind.Literal:
      return {
        kind: OperandKind.Literal,
        value:
          previous.kind === OperandKind.Literal
            ? previous.value
            : defaultLiteralValue(carryValueTypeFrom(previous)),
      };
  }
}

/** Best-effort carry of a previous operand's value type when switching kinds. */
function carryValueTypeFrom(previous: ConditionOperand): StateValueType {
  if (previous.kind === OperandKind.Literal) return previous.value.type;
  return previous.valueType;
}

/** A neutral starter literal value for a given type — used when switching to Literal. */
function defaultLiteralValue(
  type: StateValueType,
):
  | { type: StateValueType.String; value: string }
  | { type: StateValueType.Number; value: number }
  | { type: StateValueType.Bool; value: boolean }
  | { type: StateValueType.Enum; value: string } {
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
