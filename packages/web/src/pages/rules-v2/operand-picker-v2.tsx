import {
  type IndicatorInstance,
  type Period,
  RulesV2,
  type StateValue,
  StateValueType,
} from '@lametrader/core';
import { Flex, Select, Switch, TextField } from '@radix-ui/themes';
import type { ReactNode } from 'react';

/**
 * Drop-down options for the operand-kind selector, in the order they render.
 *
 * Grouped by category so the picker reads top-to-bottom: tick / bar OHLCV /
 * references / literal.
 * The literal `Price` label replaces v1's `Current` per ADR 0016.
 */
export const OPERAND_KIND_OPTIONS: ReadonlyArray<{
  value: RulesV2.OperandKind;
  label: string;
  group: 'tick' | 'bar' | 'reference' | 'literal';
}> = [
  { value: RulesV2.OperandKind.Price, label: 'Price', group: 'tick' },
  { value: RulesV2.OperandKind.Open, label: 'Open', group: 'bar' },
  { value: RulesV2.OperandKind.High, label: 'High', group: 'bar' },
  { value: RulesV2.OperandKind.Low, label: 'Low', group: 'bar' },
  { value: RulesV2.OperandKind.Close, label: 'Close', group: 'bar' },
  { value: RulesV2.OperandKind.Volume, label: 'Volume', group: 'bar' },
  { value: RulesV2.OperandKind.IndicatorRef, label: 'Indicator', group: 'reference' },
  { value: RulesV2.OperandKind.SymbolStateRef, label: 'Symbol state', group: 'reference' },
  { value: RulesV2.OperandKind.GlobalStateRef, label: 'Global state', group: 'reference' },
  { value: RulesV2.OperandKind.Literal, label: 'Value', group: 'literal' },
];

/**
 * Whether a v2 operand requires the row's `interval` to resolve at evaluation
 * time.
 *
 * `Price` and the state-refs are interval-agnostic per ADR 0016; OHLCV +
 * `IndicatorRef` need a bar `Period`.
 */
export function operandNeedsInterval(operand: RulesV2.ConditionOperand): boolean {
  switch (operand.kind) {
    case RulesV2.OperandKind.Open:
    case RulesV2.OperandKind.High:
    case RulesV2.OperandKind.Low:
    case RulesV2.OperandKind.Close:
    case RulesV2.OperandKind.Volume:
    case RulesV2.OperandKind.IndicatorRef:
      return true;
    case RulesV2.OperandKind.Price:
    case RulesV2.OperandKind.SymbolStateRef:
    case RulesV2.OperandKind.GlobalStateRef:
    case RulesV2.OperandKind.Literal:
      return false;
  }
}

/**
 * The kinds a right-hand-side operand may NOT take when the LHS already
 * forces the family — e.g. `Literal` is the only RHS-only kind in v2, but the
 * picker doesn't expose `Price`-as-RHS on a Crossing leaf (semantically odd).
 *
 * Keep this conservative: the schema accepts every operand on every side, so
 * if the user wants something exotic they can flip the leaf's family.
 */
export const RHS_ALLOWED_KINDS = OPERAND_KIND_OPTIONS.map((option) => option.value);

/**
 * A controlled picker for a single v2 condition operand. Renders the kind
 * dropdown plus the per-kind inner inputs (indicator-instance + state-field
 * dropdowns, state-key dropdown + freetext fallback, literal value typed by
 * the LHS `valueType`).
 *
 * @param value          - The current operand.
 * @param onChange       - Receives the next operand on any edit.
 * @param indicators     - Profile-attached indicator instances (drives the
 *                          IndicatorRef instance dropdown). Filtered to the
 *                          row's `interval` by the caller before passing in.
 * @param symbolStateKeys - Known symbol-state keys to seed the dropdown.
 * @param globalStateKeys - Known global-state keys to seed the dropdown.
 * @param literalValueType - When this is an RHS Literal, the LHS-derived value
 *                            type that types the input control. `undefined`
 *                            means "infer from the operand itself".
 * @param ariaLabel      - Accessible name for the kind dropdown (e.g.
 *                          "Left operand kind").
 */
export function OperandPickerV2({
  value,
  onChange,
  indicators,
  symbolStateKeys,
  globalStateKeys,
  literalValueType,
  ariaLabel,
}: {
  value: RulesV2.ConditionOperand;
  onChange: (next: RulesV2.ConditionOperand) => void;
  indicators: IndicatorInstance[];
  symbolStateKeys: string[];
  globalStateKeys: string[];
  literalValueType?: StateValueType;
  ariaLabel: string;
}): ReactNode {
  return (
    <Flex direction="column" gap="2">
      <Select.Root
        value={value.kind}
        onValueChange={(next) =>
          onChange(
            operandFromKind(next as RulesV2.OperandKind, value, indicators, literalValueType),
          )
        }
      >
        <Select.Trigger aria-label={ariaLabel} />
        <Select.Content>
          <Select.Group>
            <Select.Label>Tick</Select.Label>
            {OPERAND_KIND_OPTIONS.filter((option) => option.group === 'tick').map((option) => (
              <Select.Item key={option.value} value={option.value}>
                {option.label}
              </Select.Item>
            ))}
          </Select.Group>
          <Select.Group>
            <Select.Label>Bar</Select.Label>
            {OPERAND_KIND_OPTIONS.filter((option) => option.group === 'bar').map((option) => (
              <Select.Item key={option.value} value={option.value}>
                {option.label}
              </Select.Item>
            ))}
          </Select.Group>
          <Select.Group>
            <Select.Label>Reference</Select.Label>
            {OPERAND_KIND_OPTIONS.filter((option) => option.group === 'reference').map((option) => (
              <Select.Item key={option.value} value={option.value}>
                {option.label}
              </Select.Item>
            ))}
          </Select.Group>
          <Select.Group>
            <Select.Label>Literal</Select.Label>
            {OPERAND_KIND_OPTIONS.filter((option) => option.group === 'literal').map((option) => (
              <Select.Item key={option.value} value={option.value}>
                {option.label}
              </Select.Item>
            ))}
          </Select.Group>
        </Select.Content>
      </Select.Root>
      <OperandDetail
        value={value}
        onChange={onChange}
        indicators={indicators}
        symbolStateKeys={symbolStateKeys}
        globalStateKeys={globalStateKeys}
        literalValueType={literalValueType}
      />
    </Flex>
  );
}

/**
 * The per-kind inner editor — rendered as a sibling of the kind dropdown.
 *
 * `Price` / `Open` / `High` / `Low` / `Close` / `Volume` render nothing (the
 * kind dropdown is the whole control). `IndicatorRef` renders an instance +
 * state-field dropdown pair. `SymbolStateRef` / `GlobalStateRef` render a key
 * dropdown + freetext fallback. `Literal` renders a typed value input.
 */
function OperandDetail({
  value,
  onChange,
  indicators,
  symbolStateKeys,
  globalStateKeys,
  literalValueType,
}: {
  value: RulesV2.ConditionOperand;
  onChange: (next: RulesV2.ConditionOperand) => void;
  indicators: IndicatorInstance[];
  symbolStateKeys: string[];
  globalStateKeys: string[];
  literalValueType?: StateValueType;
}): ReactNode {
  switch (value.kind) {
    case RulesV2.OperandKind.Price:
    case RulesV2.OperandKind.Open:
    case RulesV2.OperandKind.High:
    case RulesV2.OperandKind.Low:
    case RulesV2.OperandKind.Close:
    case RulesV2.OperandKind.Volume:
      return null;
    case RulesV2.OperandKind.IndicatorRef:
      return (
        <Flex direction="column" gap="2">
          <Select.Root
            value={value.instanceId === '' ? undefined : value.instanceId}
            onValueChange={(next) => onChange({ ...value, instanceId: next })}
          >
            <Select.Trigger placeholder="Pick an indicator" aria-label="Indicator instance" />
            <Select.Content>
              {indicators.map((instance) => (
                <Select.Item key={instance.id} value={instance.id}>
                  {instance.summary ?? instance.label ?? instance.indicatorKey}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <TextField.Root
            aria-label="Indicator state field"
            placeholder="State field key (e.g. signal)"
            value={value.stateKey}
            onChange={(event) => onChange({ ...value, stateKey: event.target.value })}
          />
        </Flex>
      );
    case RulesV2.OperandKind.SymbolStateRef:
      return (
        <StateKeyPicker
          value={value.key}
          knownKeys={symbolStateKeys}
          ariaLabel="Symbol state key"
          onChange={(key) => onChange({ ...value, key })}
        />
      );
    case RulesV2.OperandKind.GlobalStateRef:
      return (
        <StateKeyPicker
          value={value.key}
          knownKeys={globalStateKeys}
          ariaLabel="Global state key"
          onChange={(key) => onChange({ ...value, key })}
        />
      );
    case RulesV2.OperandKind.Literal:
      return (
        <LiteralValueInput
          value={value}
          inferredType={literalValueType ?? value.value.type}
          onChange={onChange}
        />
      );
  }
}

/**
 * The literal-value input — picks a control by the resolved LHS `valueType`
 * (or the operand's own `value.type` when the LHS hasn't propagated one).
 *
 * Numeric → numeric stepper (the `<TextField>` with `type="number"` so users
 * can clear and re-type); bool → switch; string / enum → text input.
 * Mismatches are caught by the v2 schema validator at the API boundary; this
 * UI control simply renders the right widget so the data stays in shape.
 */
function LiteralValueInput({
  value,
  inferredType,
  onChange,
}: {
  value: { kind: RulesV2.OperandKind.Literal; value: { type: StateValueType; value: unknown } };
  inferredType: StateValueType;
  onChange: (next: RulesV2.ConditionOperand) => void;
}): ReactNode {
  switch (inferredType) {
    case StateValueType.Number: {
      const current =
        value.value.type === StateValueType.Number && typeof value.value.value === 'number'
          ? value.value.value
          : 0;
      return (
        <TextField.Root
          aria-label="Literal value"
          type="number"
          inputMode="decimal"
          step="any"
          value={Number.isFinite(current) ? current : 0}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            onChange({
              kind: RulesV2.OperandKind.Literal,
              value: { type: StateValueType.Number, value: Number.isFinite(parsed) ? parsed : 0 },
            });
          }}
        />
      );
    }
    case StateValueType.Bool: {
      const current = value.value.type === StateValueType.Bool ? Boolean(value.value.value) : false;
      return (
        <Switch
          aria-label="Literal value"
          checked={current}
          onCheckedChange={(next) =>
            onChange({
              kind: RulesV2.OperandKind.Literal,
              value: { type: StateValueType.Bool, value: next === true },
            })
          }
        />
      );
    }
    case StateValueType.String:
    case StateValueType.Enum: {
      const current =
        (value.value.type === StateValueType.String || value.value.type === StateValueType.Enum) &&
        typeof value.value.value === 'string'
          ? value.value.value
          : '';
      return (
        <TextField.Root
          aria-label="Literal value"
          value={current}
          onChange={(event) =>
            onChange({
              kind: RulesV2.OperandKind.Literal,
              value: { type: inferredType, value: event.target.value },
            })
          }
        />
      );
    }
  }
}

/**
 * The state-key picker — a Radix `<Select>` seeded with known keys + a freetext
 * `<TextField>` fallback for keys that don't exist yet (per #396 AC).
 *
 * The control width is full-width so it lines up with the rest of the row.
 */
function StateKeyPicker({
  value,
  knownKeys,
  ariaLabel,
  onChange,
}: {
  value: string;
  knownKeys: string[];
  ariaLabel: string;
  onChange: (key: string) => void;
}): ReactNode {
  // De-duplicate while preserving order so a key the user just typed still
  // appears in the dropdown for re-selection.
  const seen = new Set<string>();
  const options: string[] = [];
  for (const key of knownKeys) {
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    options.push(key);
  }
  return (
    <Flex direction="column" gap="2">
      <Select.Root value={value === '' ? undefined : value} onValueChange={onChange}>
        <Select.Trigger placeholder="Pick a key" aria-label={ariaLabel} />
        <Select.Content>
          {options.map((key) => (
            <Select.Item key={key} value={key}>
              {key}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
      <TextField.Root
        aria-label={`${ariaLabel} (custom)`}
        placeholder="Or type a new key"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Flex>
  );
}

/**
 * Build a fresh operand for a kind change.
 *
 * Preserves the LHS `valueType` for `Literal` so the input control stays the
 * right widget after the user flips between kinds.
 * Indicator/state operands start at empty strings — the user must complete
 * them before the leaf is sensible (the editor's submit handler rejects empty
 * required fields).
 */
export function operandFromKind(
  kind: RulesV2.OperandKind,
  prev: RulesV2.ConditionOperand,
  indicators: IndicatorInstance[],
  literalValueType?: StateValueType,
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
      const firstInstance = indicators[0]?.id ?? '';
      return {
        kind: RulesV2.OperandKind.IndicatorRef,
        instanceId:
          prev.kind === RulesV2.OperandKind.IndicatorRef ? prev.instanceId : firstInstance,
        stateKey: prev.kind === RulesV2.OperandKind.IndicatorRef ? prev.stateKey : '',
        valueType:
          prev.kind === RulesV2.OperandKind.IndicatorRef
            ? prev.valueType
            : (literalValueType ?? StateValueType.Number),
      };
    }
    case RulesV2.OperandKind.SymbolStateRef:
      return {
        kind: RulesV2.OperandKind.SymbolStateRef,
        key: prev.kind === RulesV2.OperandKind.SymbolStateRef ? prev.key : '',
        valueType:
          prev.kind === RulesV2.OperandKind.SymbolStateRef
            ? prev.valueType
            : (literalValueType ?? StateValueType.Number),
      };
    case RulesV2.OperandKind.GlobalStateRef:
      return {
        kind: RulesV2.OperandKind.GlobalStateRef,
        key: prev.kind === RulesV2.OperandKind.GlobalStateRef ? prev.key : '',
        valueType:
          prev.kind === RulesV2.OperandKind.GlobalStateRef
            ? prev.valueType
            : (literalValueType ?? StateValueType.Number),
      };
    case RulesV2.OperandKind.Literal: {
      const type = literalValueType ?? StateValueType.Number;
      return {
        kind: RulesV2.OperandKind.Literal,
        value: defaultLiteralValue(type),
      };
    }
  }
}

/**
 * Build a sensible default {@link StateValue} `Literal` value for a given
 * `StateValueType` — used when the user flips the LHS to a new type and the
 * RHS literal needs to follow.
 */
function defaultLiteralValue(type: StateValueType): StateValue {
  switch (type) {
    case StateValueType.Number:
      return { type, value: 0 };
    case StateValueType.Bool:
      return { type, value: false };
    case StateValueType.String:
      return { type, value: '' };
    case StateValueType.Enum:
      return { type, value: '' };
  }
}

/**
 * Filter a list of profile-attached indicator instances by the row's `interval`.
 *
 * v2 indicator operand binding is profile-attached only (per ADR 0016): the
 * row's `Interval` selects which period's instances are eligible. When the
 * row has no interval yet, every instance is allowed (the user has more to
 * configure before submit).
 */
export function filterIndicatorsByInterval(
  indicators: IndicatorInstance[],
  interval: Period | undefined,
  instancePeriods: Record<string, Period | undefined>,
): IndicatorInstance[] {
  if (interval === undefined) return indicators;
  return indicators.filter((instance) => {
    const period = instancePeriods[instance.id];
    return period === undefined || period === interval;
  });
}
