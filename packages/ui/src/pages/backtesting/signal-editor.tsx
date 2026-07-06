import { type BacktestSignal, type StateValue, StateValueType } from '@lametrader/core';
import { Flex, Select, Switch, Text, TextField } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import type { SymbolStateKey } from '../../lib/hooks/state.js';
import { StateKeyPicker } from '../rules/state-key-picker.js';

/**
 * A sensible empty {@link StateValue} for a declared {@link StateValueType} —
 * used when the user adopts a key's type or declares a fresh one, so the value
 * widget always has an in-shape value to render.
 */
export function defaultStateValue(type: StateValueType): StateValue {
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
 * The typed value editor for a {@link BacktestSignal}.
 *
 * Reuses the rules-editor state-key machinery: a find-or-create
 * {@link StateKeyPicker} combobox seeded from the selected symbol's state-key
 * catalog, and a value widget that follows the key's declared type. Picking a
 * key already in the catalog adopts its type (the value control switches to
 * match); a key not in the catalog is a brand-new declaration, so a `Value type`
 * row appears for the user to choose its type up front.
 *
 * The value widget mirrors the operand picker's literal input: number → numeric
 * field, bool → switch, string → text field. There is no enum-select branch —
 * the symbol state-key catalog carries only a {@link StateValueType}, no closed
 * option set, so a string key resolves to a free-text field.
 *
 * @param value      - The current signal (`key` + tagged `value`).
 * @param knownKeys  - The selected symbol's state-key catalog (key + type).
 * @param ariaPrefix - Prefixes the control accessible names (e.g. `'Entry signal'`
 *                       yields `'Entry signal state key'` / `'Entry signal value'`).
 * @param isLoading  - When `true`, the key combobox shows its loading state.
 * @param onChange   - Receives the next signal on any edit.
 */
export function SignalEditor({
  value,
  knownKeys,
  ariaPrefix,
  isLoading,
  onChange,
}: {
  value: BacktestSignal;
  knownKeys: SymbolStateKey[];
  ariaPrefix: string;
  isLoading?: boolean;
  onChange: (next: BacktestSignal) => void;
}): ReactNode {
  const catalog = new Map<string, StateValueType>();
  for (const entry of knownKeys) catalog.set(entry.key, entry.valueType);
  const knownType = value.key === '' ? undefined : catalog.get(value.key);
  const isUnknownKey = value.key !== '' && knownType === undefined;

  return (
    <Flex direction="column" gap="2">
      <StateKeyPicker
        value={value.key}
        knownKeys={[...catalog.keys()]}
        ariaLabel={`${ariaPrefix} state key`}
        isLoading={isLoading}
        onChange={(key) => {
          const catalogType = catalog.get(key);
          // A known key adopts its catalog type (the widget follows it); an
          // unknown key keeps the current value so the just-declared type sticks.
          if (catalogType !== undefined) {
            onChange({ key, value: defaultStateValue(catalogType) });
            return;
          }
          onChange({ key, value: value.value });
        }}
      />
      {isUnknownKey ? (
        <Flex gap="2" align="center">
          <Text size="2" color="gray">
            Value type
          </Text>
          <Select.Root
            value={value.value.type}
            onValueChange={(next) =>
              onChange({ key: value.key, value: defaultStateValue(next as StateValueType) })
            }
          >
            <Select.Trigger aria-label={`${ariaPrefix} value type`} />
            <Select.Content>
              {Object.values(StateValueType).map((type) => (
                <Select.Item key={type} value={type}>
                  {type}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>
      ) : null}
      <SignalValueInput
        value={value.value}
        ariaLabel={`${ariaPrefix} value`}
        onChange={(next) => onChange({ key: value.key, value: next })}
      />
    </Flex>
  );
}

/**
 * The per-type value control for a signal's target value.
 *
 * Numeric → numeric field (`type="number"` so the user can clear and re-type),
 * bool → switch, string → text field. Mirrors the operand picker's
 * `LiteralValueInput`, scoped to a bare {@link StateValue} (a signal carries no
 * enum options, so string is always free text).
 */
function SignalValueInput({
  value,
  ariaLabel,
  onChange,
}: {
  value: StateValue;
  ariaLabel: string;
  onChange: (next: StateValue) => void;
}): ReactNode {
  switch (value.type) {
    case StateValueType.Number:
      return (
        <TextField.Root
          aria-label={ariaLabel}
          type="number"
          inputMode="decimal"
          step="any"
          value={Number.isFinite(value.value) ? value.value : 0}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            onChange({ type: StateValueType.Number, value: Number.isFinite(parsed) ? parsed : 0 });
          }}
        />
      );
    case StateValueType.Bool:
      return (
        <Switch
          aria-label={ariaLabel}
          checked={value.value}
          onCheckedChange={(next) => onChange({ type: StateValueType.Bool, value: next === true })}
        />
      );
    case StateValueType.String:
      return (
        <TextField.Root
          aria-label={ariaLabel}
          value={value.value}
          onChange={(event) => onChange({ type: StateValueType.String, value: event.target.value })}
        />
      );
  }
}
