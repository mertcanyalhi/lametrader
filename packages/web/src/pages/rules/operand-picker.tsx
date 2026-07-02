import {
  type ConditionOperand,
  type IndicatorInstance,
  OperandKind,
  type Period,
  ProfileScope,
  type ProfileScopeSpec,
  type RuleScope,
  RuleScopeKind,
  type StateValue,
  StateValueType,
} from '@lametrader/core';
import { Flex, Select, Switch, Text, TextField } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import type { KnownStateKeys } from './leaf-editor.js';
import { StateKeyPicker } from './state-key-picker.js';

/**
 * Per-indicator-key catalog of the state-field keys the definition declares.
 *
 * Keyed by {@link IndicatorDefinition.key} (e.g. `'sma'` → `['value']`,
 * `'supertrend'` → `['signal', 'value']`).
 *
 * Feeds the `IndicatorRef` operand's state-key combobox — missing entries fall
 * through to a freetext-only picker via {@link StateKeyPicker}'s empty-list
 * behaviour.
 */
export type IndicatorStateKeysByKey = Record<string, string[]>;

/**
 * Drop-down options for the operand-kind selector, in the order they render.
 *
 * Grouped by category so the picker reads top-to-bottom: tick / bar OHLCV /
 * references / literal.
 * The literal `Price` label replaces v1's `Current` per ADR 0016.
 */
export const OPERAND_KIND_OPTIONS: ReadonlyArray<{
  value: OperandKind;
  label: string;
  group: 'tick' | 'bar' | 'reference' | 'literal';
}> = [
  { value: OperandKind.Price, label: 'Price', group: 'tick' },
  { value: OperandKind.Open, label: 'Open', group: 'bar' },
  { value: OperandKind.High, label: 'High', group: 'bar' },
  { value: OperandKind.Low, label: 'Low', group: 'bar' },
  { value: OperandKind.Close, label: 'Close', group: 'bar' },
  { value: OperandKind.Volume, label: 'Volume', group: 'bar' },
  { value: OperandKind.IndicatorRef, label: 'Indicator', group: 'reference' },
  { value: OperandKind.SymbolStateRef, label: 'Symbol state', group: 'reference' },
  { value: OperandKind.GlobalStateRef, label: 'Global state', group: 'reference' },
  { value: OperandKind.Literal, label: 'Value', group: 'literal' },
];

/**
 * Whether an operand requires the row's `interval` to resolve at evaluation
 * time.
 *
 * `Price` and the state-refs are interval-agnostic per ADR 0016; OHLCV +
 * `IndicatorRef` need a bar `Period`.
 */
export function operandNeedsInterval(operand: ConditionOperand): boolean {
  switch (operand.kind) {
    case OperandKind.Open:
    case OperandKind.High:
    case OperandKind.Low:
    case OperandKind.Close:
    case OperandKind.Volume:
    case OperandKind.IndicatorRef:
      return true;
    case OperandKind.Price:
    case OperandKind.SymbolStateRef:
    case OperandKind.GlobalStateRef:
    case OperandKind.Literal:
      return false;
  }
}

/**
 * The kinds a right-hand-side operand may NOT take when the LHS already
 * forces the family — e.g. `Literal` is the only RHS-only kind, but the
 * picker doesn't expose `Price`-as-RHS on a Crossing leaf (semantically odd).
 *
 * Keep this conservative: the schema accepts every operand on every side, so
 * if the user wants something exotic they can flip the leaf's family.
 */
export const RHS_ALLOWED_KINDS = OPERAND_KIND_OPTIONS.map((option) => option.value);

/**
 * A controlled picker for a single condition operand. Renders the kind
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
 * @param indicatorStateKeysByKey - Per-indicator-definition state-key catalog,
 *                                    keyed by `IndicatorDefinition.key`. Used
 *                                    to seed the `IndicatorRef.stateKey`
 *                                    combobox. Missing entries fall through
 *                                    to a freetext-only picker.
 * @param literalValueType - When this is an RHS Literal, the LHS-derived value
 *                            type that types the input control. `undefined`
 *                            means "infer from the operand itself".
 * @param ariaLabel      - Accessible name for the kind dropdown (e.g.
 *                          "Left operand kind").
 */
export function OperandPicker({
  value,
  onChange,
  indicators,
  knownStateKeys,
  stateKeysLoading,
  indicatorStateKeysByKey,
  literalValueType,
  ariaLabel,
}: {
  value: ConditionOperand;
  onChange: (next: ConditionOperand) => void;
  indicators: IndicatorInstance[];
  knownStateKeys: KnownStateKeys;
  stateKeysLoading?: boolean;
  indicatorStateKeysByKey?: IndicatorStateKeysByKey;
  literalValueType?: StateValueType;
  ariaLabel: string;
}): ReactNode {
  return (
    <Flex direction="column" gap="2">
      <Select.Root
        value={value.kind}
        onValueChange={(next) =>
          onChange(operandFromKind(next as OperandKind, value, indicators, literalValueType))
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
        knownStateKeys={knownStateKeys}
        stateKeysLoading={stateKeysLoading}
        indicatorStateKeysByKey={indicatorStateKeysByKey}
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
  knownStateKeys,
  stateKeysLoading,
  indicatorStateKeysByKey,
  literalValueType,
}: {
  value: ConditionOperand;
  onChange: (next: ConditionOperand) => void;
  indicators: IndicatorInstance[];
  knownStateKeys: KnownStateKeys;
  stateKeysLoading?: boolean;
  indicatorStateKeysByKey?: IndicatorStateKeysByKey;
  literalValueType?: StateValueType;
}): ReactNode {
  switch (value.kind) {
    case OperandKind.Price:
    case OperandKind.Open:
    case OperandKind.High:
    case OperandKind.Low:
    case OperandKind.Close:
    case OperandKind.Volume:
      return null;
    case OperandKind.IndicatorRef: {
      const selected = indicators.find((instance) => instance.id === value.instanceId);
      const indicatorKey = selected?.indicatorKey ?? '';
      const indicatorKeyList = indicatorStateKeysByKey?.[indicatorKey] ?? [];
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
          <StateKeyPicker
            value={value.stateKey}
            knownKeys={indicatorKeyList}
            ariaLabel="Indicator state field"
            onChange={(stateKey) => onChange({ ...value, stateKey })}
          />
        </Flex>
      );
    }
    case OperandKind.SymbolStateRef: {
      const symbolMap = knownStateKeys.symbol;
      const knownForCurrent = value.key === '' ? undefined : symbolMap[value.key];
      return (
        <Flex direction="column" gap="2">
          <StateKeyPicker
            value={value.key}
            knownKeys={Object.keys(symbolMap)}
            ariaLabel="Symbol state key"
            isLoading={stateKeysLoading}
            onChange={(key) => {
              const known = symbolMap[key];
              if (known === undefined) {
                onChange({ ...value, key });
                return;
              }
              onChange({ ...value, key, valueType: known.type });
            }}
          />
          {knownForCurrent === undefined ? (
            <ValueTypeRow
              value={value.valueType}
              ariaLabel="Symbol state value type"
              onChange={(valueType) => onChange({ ...value, valueType })}
            />
          ) : null}
        </Flex>
      );
    }
    case OperandKind.GlobalStateRef: {
      const globalMap = knownStateKeys.global;
      const knownForCurrent = value.key === '' ? undefined : globalMap[value.key];
      return (
        <Flex direction="column" gap="2">
          <StateKeyPicker
            value={value.key}
            knownKeys={Object.keys(globalMap)}
            ariaLabel="Global state key"
            isLoading={stateKeysLoading}
            onChange={(key) => {
              const known = globalMap[key];
              if (known === undefined) {
                onChange({ ...value, key });
                return;
              }
              onChange({ ...value, key, valueType: known.type });
            }}
          />
          {knownForCurrent === undefined ? (
            <ValueTypeRow
              value={value.valueType}
              ariaLabel="Global state value type"
              onChange={(valueType) => onChange({ ...value, valueType })}
            />
          ) : null}
        </Flex>
      );
    }
    case OperandKind.Literal:
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
 * `Value type` picker rendered next to a state-ref operand's key combobox when
 * the key isn't in the known-state catalog (freetext / to-be-created key).
 *
 * Lets the user declare the ref's `valueType` up front so the operator picker
 * narrows correctly and any downstream RHS literal picks the right widget.
 * Known keys hide this row — the persisted type is authoritative.
 */
function ValueTypeRow({
  value,
  ariaLabel,
  onChange,
}: {
  value: StateValueType;
  ariaLabel: string;
  onChange: (next: StateValueType) => void;
}): ReactNode {
  return (
    <Flex gap="2" align="center">
      <Text size="2" color="gray">
        Value type
      </Text>
      <Select.Root value={value} onValueChange={(next) => onChange(next as StateValueType)}>
        <Select.Trigger aria-label={ariaLabel} />
        <Select.Content>
          {Object.values(StateValueType).map((type) => (
            <Select.Item key={type} value={type}>
              {type}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </Flex>
  );
}

/**
 * The literal-value input — picks a control by the resolved LHS `valueType`
 * (or the operand's own `value.type` when the LHS hasn't propagated one).
 *
 * Numeric → numeric stepper (the `<TextField>` with `type="number"` so users
 * can clear and re-type); bool → switch; string / enum → text input.
 * Mismatches are caught by the domain schema validator at the API boundary;
 * this UI control simply renders the right widget so the data stays in shape.
 */
function LiteralValueInput({
  value,
  inferredType,
  onChange,
}: {
  value: { kind: OperandKind.Literal; value: { type: StateValueType; value: unknown } };
  inferredType: StateValueType;
  onChange: (next: ConditionOperand) => void;
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
              kind: OperandKind.Literal,
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
              kind: OperandKind.Literal,
              value: { type: StateValueType.Bool, value: next === true },
            })
          }
        />
      );
    }
    case StateValueType.String: {
      const current =
        value.value.type === StateValueType.String && typeof value.value.value === 'string'
          ? value.value.value
          : '';
      return (
        <TextField.Root
          aria-label="Literal value"
          value={current}
          onChange={(event) =>
            onChange({
              kind: OperandKind.Literal,
              value: { type: inferredType, value: event.target.value },
            })
          }
        />
      );
    }
  }
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
  kind: OperandKind,
  prev: ConditionOperand,
  indicators: IndicatorInstance[],
  literalValueType?: StateValueType,
): ConditionOperand {
  switch (kind) {
    case OperandKind.Price:
    case OperandKind.Open:
    case OperandKind.High:
    case OperandKind.Low:
    case OperandKind.Close:
    case OperandKind.Volume:
      return { kind };
    case OperandKind.IndicatorRef: {
      const firstInstance = indicators[0]?.id ?? '';
      return {
        kind: OperandKind.IndicatorRef,
        instanceId: prev.kind === OperandKind.IndicatorRef ? prev.instanceId : firstInstance,
        stateKey: prev.kind === OperandKind.IndicatorRef ? prev.stateKey : '',
        valueType:
          prev.kind === OperandKind.IndicatorRef
            ? prev.valueType
            : (literalValueType ?? StateValueType.Number),
      };
    }
    case OperandKind.SymbolStateRef:
      return {
        kind: OperandKind.SymbolStateRef,
        key: prev.kind === OperandKind.SymbolStateRef ? prev.key : '',
        valueType:
          prev.kind === OperandKind.SymbolStateRef
            ? prev.valueType
            : (literalValueType ?? StateValueType.Number),
      };
    case OperandKind.GlobalStateRef:
      return {
        kind: OperandKind.GlobalStateRef,
        key: prev.kind === OperandKind.GlobalStateRef ? prev.key : '',
        valueType:
          prev.kind === OperandKind.GlobalStateRef
            ? prev.valueType
            : (literalValueType ?? StateValueType.Number),
      };
    case OperandKind.Literal: {
      const type = literalValueType ?? StateValueType.Number;
      return {
        kind: OperandKind.Literal,
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
  }
}

/**
 * Filter a list of profile-attached indicator instances by the rule's scope.
 *
 * Profile-attached indicators apply to every symbol the profile covers.
 * The rule's scope picks which symbols its leaves are evaluated against; when
 * the rule scope is `Symbols(list)`, every selected symbol must be inside the
 * profile's scope for the profile's indicators to be considered "common across
 * the selection".
 *
 * Resolution (per ADR / issue #428 DQ2):
 * - Rule scope `Symbol` (single) — pass every profile indicator through; the
 *   row applies to one symbol, so commonality is trivial.
 * - Rule scope `AllSymbols` — pass every profile indicator through; this is
 *   the lazy fallback documented in the issue (computing the watchlist
 *   intersection is costly and mutates as the watchlist grows).
 * - Rule scope `Symbols(list)`:
 *   - Profile scope `All` — every selected symbol is covered, pass everything.
 *   - Profile scope `Symbols(profileIds)` — only pass indicators when every
 *     rule-selected symbol id is in `profileIds`; otherwise return `[]`
 *     (no common indicator exists for the selection).
 *
 * @param indicators   - The profile's attached indicator instances.
 * @param ruleScope    - The rule's scope (Symbol / Symbols / AllSymbols).
 * @param profileScope - The profile's scope (All / Symbols).
 *                          Use `undefined` when the profile hasn't loaded yet —
 *                          the function returns `indicators` unchanged so the
 *                          user can still see options while the data settles.
 */
export function filterIndicatorsByScope(
  indicators: IndicatorInstance[],
  ruleScope: RuleScope,
  profileScope: ProfileScopeSpec | undefined,
): IndicatorInstance[] {
  if (profileScope === undefined) return indicators;
  switch (ruleScope.kind) {
    case RuleScopeKind.Symbol:
    case RuleScopeKind.AllSymbols:
      return indicators;
    case RuleScopeKind.Symbols: {
      if (profileScope.type === ProfileScope.All) return indicators;
      const allCovered = ruleScope.symbolIds.every((id) => profileScope.symbolIds.includes(id));
      return allCovered ? indicators : [];
    }
  }
}

/**
 * Filter a list of profile-attached indicator instances by the row's `interval`.
 *
 * Indicator operand binding is profile-attached only (per ADR 0016): the
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
