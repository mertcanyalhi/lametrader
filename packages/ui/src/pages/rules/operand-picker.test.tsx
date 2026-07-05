// @vitest-environment jsdom
import {
  type ConditionOperand,
  type EnumOption,
  FieldType,
  type IndicatorInstance,
  OperandKind,
  ProfileScope,
  RuleScopeKind,
  type StateFieldDescriptor,
  StateValueType,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { KnownStateKeys } from './leaf-editor';
import { filterIndicatorsByScope, OPERAND_KIND_OPTIONS, OperandPicker } from './operand-picker';

afterEach(() => {
  cleanup();
});

/** A small wrapper for stateful render testing. */
function Harness({
  initial,
  indicators = [],
  knownStateKeys = { symbol: {}, global: {} },
  indicatorStateFieldsByKey,
  literalValueType,
  literalEnumOptions,
  onSnapshot,
}: {
  initial: ConditionOperand;
  indicators?: IndicatorInstance[];
  knownStateKeys?: KnownStateKeys;
  indicatorStateFieldsByKey?: Record<string, StateFieldDescriptor[]>;
  literalValueType?: StateValueType;
  literalEnumOptions?: EnumOption[];
  onSnapshot?: (operand: ConditionOperand) => void;
}): ReactNode {
  const [value, setValue] = useState<ConditionOperand>(initial);
  return (
    <Theme>
      <OperandPicker
        value={value}
        onChange={(next) => {
          setValue(next);
          onSnapshot?.(next);
        }}
        indicators={indicators}
        knownStateKeys={knownStateKeys}
        indicatorStateFieldsByKey={indicatorStateFieldsByKey}
        literalValueType={literalValueType}
        literalEnumOptions={literalEnumOptions}
        ariaLabel="Left operand kind"
      />
    </Theme>
  );
}

/** Supertrend's declared state schema: an enum `signal` then a numeric `value`. */
const SUPERTREND_FIELDS: StateFieldDescriptor[] = [
  {
    type: FieldType.Enum,
    key: 'signal',
    label: 'Signal',
    options: [
      { value: 'up', label: 'Up Trend' },
      { value: 'down', label: 'Down Trend' },
    ],
  },
  { type: FieldType.Number, key: 'value', label: 'Trend Value' },
];

/** SMA's declared state schema: a single numeric `value`. */
const SMA_FIELDS: StateFieldDescriptor[] = [{ type: FieldType.Number, key: 'value', label: 'SMA' }];

describe('OperandPicker', () => {
  it('renders the Price label (replaces v1 Current) in the kind option set', () => {
    const labels = OPERAND_KIND_OPTIONS.map((option) => option.label);
    expect(labels).toEqual([
      'Price',
      'Open',
      'High',
      'Low',
      'Close',
      'Volume',
      'Indicator',
      'Symbol state',
      'Global state',
      'Value',
    ]);
  });

  it('renders a numeric stepper for a Literal LHS-derived to Number', () => {
    render(
      <Harness
        initial={{
          kind: OperandKind.Literal,
          value: { type: StateValueType.Number, value: 120 },
        }}
        literalValueType={StateValueType.Number}
      />,
    );
    const literal = screen.getByLabelText('Literal value') as HTMLInputElement;
    expect({ type: literal.type, value: literal.value }).toEqual({ type: 'number', value: '120' });
  });

  it('renders a switch toggle for a Literal LHS-derived to Bool', () => {
    render(
      <Harness
        initial={{
          kind: OperandKind.Literal,
          value: { type: StateValueType.Bool, value: true },
        }}
        literalValueType={StateValueType.Bool}
      />,
    );
    const literal = screen.getByLabelText('Literal value');
    expect({
      role: literal.getAttribute('role'),
      checked: literal.getAttribute('aria-checked'),
    }).toEqual({
      role: 'switch',
      checked: 'true',
    });
  });

  it('renders a freetext input fallback when an LHS resolves to String', () => {
    render(
      <Harness
        initial={{
          kind: OperandKind.Literal,
          value: { type: StateValueType.String, value: 'Up Trend' },
        }}
        literalValueType={StateValueType.String}
      />,
    );
    const literal = screen.getByLabelText('Literal value') as HTMLInputElement;
    expect({ type: literal.type, value: literal.value }).toEqual({
      type: 'text',
      value: 'Up Trend',
    });
  });

  it('exposes the known symbol-state keys as filterable combobox options', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{
          kind: OperandKind.SymbolStateRef,
          key: '',
          valueType: StateValueType.Number,
        }}
        knownStateKeys={{
          symbol: {
            lastFiredAt: { type: StateValueType.Number, value: 0 },
            cooldown: { type: StateValueType.Number, value: 0 },
          },
          global: {},
        }}
      />,
    );
    const input = screen.getByLabelText('Symbol state key');
    await user.click(input);
    await user.keyboard('{ArrowDown}');
    expect({
      lastFiredAt: screen.getByText('lastFiredAt'),
      cooldown: screen.getByText('cooldown'),
    }).toEqual({
      lastFiredAt: expect.anything(),
      cooldown: expect.anything(),
    });
  });

  it('writes a freshly-typed symbol-state key through onCreateOption on Enter', async () => {
    const user = userEvent.setup();
    const snapshots: ConditionOperand[] = [];
    render(
      <Harness
        initial={{
          kind: OperandKind.SymbolStateRef,
          key: '',
          valueType: StateValueType.Number,
        }}
        knownStateKeys={{ symbol: {}, global: {} }}
        onSnapshot={(operand) => snapshots.push(operand)}
      />,
    );
    const input = screen.getByLabelText('Symbol state key');
    await user.click(input);
    await user.keyboard('novel{Enter}');
    const last = snapshots[snapshots.length - 1];
    expect(last).toEqual({
      kind: OperandKind.SymbolStateRef,
      key: 'novel',
      valueType: StateValueType.Number,
    });
  });

  it("adopts the known symbol-state key's valueType and hides the Value type row on pick", async () => {
    const user = userEvent.setup();
    const snapshots: ConditionOperand[] = [];
    render(
      <Harness
        initial={{
          kind: OperandKind.SymbolStateRef,
          key: '',
          valueType: StateValueType.Number,
        }}
        knownStateKeys={{
          symbol: {
            testbool: { type: StateValueType.Bool, value: true },
          },
          global: {},
        }}
        onSnapshot={(operand) => snapshots.push(operand)}
      />,
    );
    const input = screen.getByLabelText('Symbol state key');
    await user.click(input);
    await user.click(screen.getByText('testbool'));
    const last = snapshots[snapshots.length - 1];
    expect(last).toEqual({
      kind: OperandKind.SymbolStateRef,
      key: 'testbool',
      valueType: StateValueType.Bool,
    });
    expect(screen.queryByLabelText('Symbol state value type')).toEqual(null);
  });

  it("adopts a known Number-typed symbol-state key's valueType and hides the Value type row on pick", async () => {
    const user = userEvent.setup();
    const snapshots: ConditionOperand[] = [];
    render(
      <Harness
        initial={{
          kind: OperandKind.SymbolStateRef,
          key: '',
          valueType: StateValueType.String,
        }}
        knownStateKeys={{
          symbol: {
            barCount: { type: StateValueType.Number, value: 42 },
          },
          global: {},
        }}
        onSnapshot={(operand) => snapshots.push(operand)}
      />,
    );
    const input = screen.getByLabelText('Symbol state key');
    await user.click(input);
    await user.click(screen.getByText('barCount'));
    const last = snapshots[snapshots.length - 1];
    expect(last).toEqual({
      kind: OperandKind.SymbolStateRef,
      key: 'barCount',
      valueType: StateValueType.Number,
    });
    expect(screen.queryByLabelText('Symbol state value type')).toEqual(null);
  });

  it('exposes a Value type row on a freetext-created symbol-state key so the user picks its type', () => {
    render(
      <Harness
        initial={{
          kind: OperandKind.SymbolStateRef,
          key: 'novel',
          valueType: StateValueType.Number,
        }}
        knownStateKeys={{ symbol: {}, global: {} }}
      />,
    );
    expect(screen.getByLabelText('Symbol state value type')).toBeDefined();
  });

  it("adopts the known global-state key's valueType and hides the Value type row on pick", async () => {
    const user = userEvent.setup();
    const snapshots: ConditionOperand[] = [];
    render(
      <Harness
        initial={{
          kind: OperandKind.GlobalStateRef,
          key: '',
          valueType: StateValueType.Number,
        }}
        knownStateKeys={{
          symbol: {},
          global: {
            session: { type: StateValueType.String, value: 'us-open' },
          },
        }}
        onSnapshot={(operand) => snapshots.push(operand)}
      />,
    );
    const input = screen.getByLabelText('Global state key');
    await user.click(input);
    await user.click(screen.getByText('session'));
    const last = snapshots[snapshots.length - 1];
    expect(last).toEqual({
      kind: OperandKind.GlobalStateRef,
      key: 'session',
      valueType: StateValueType.String,
    });
    expect(screen.queryByLabelText('Global state value type')).toEqual(null);
  });

  it("populates the IndicatorRef state-field Select from the selected instance's schema, showing labels", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{
          kind: OperandKind.IndicatorRef,
          instanceId: 'ind-a',
          stateKey: '',
          valueType: StateValueType.Number,
        }}
        indicators={[
          {
            id: 'ind-a',
            indicatorKey: 'supertrend',
            version: 1,
            inputs: {},
            summary: 'Supertrend',
          },
        ]}
        indicatorStateFieldsByKey={{ supertrend: SUPERTREND_FIELDS, sma: SMA_FIELDS }}
      />,
    );
    await user.click(screen.getByLabelText('Indicator state field'));
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['Signal', 'Trend Value']);
  });

  it('derives the operand valueType to String when the picked state field is an enum', async () => {
    const user = userEvent.setup();
    const snapshots: ConditionOperand[] = [];
    render(
      <Harness
        initial={{
          kind: OperandKind.IndicatorRef,
          instanceId: 'ind-a',
          stateKey: '',
          valueType: StateValueType.Number,
        }}
        indicators={[
          {
            id: 'ind-a',
            indicatorKey: 'supertrend',
            version: 1,
            inputs: {},
            summary: 'Supertrend',
          },
        ]}
        indicatorStateFieldsByKey={{ supertrend: SUPERTREND_FIELDS }}
        onSnapshot={(operand) => snapshots.push(operand)}
      />,
    );
    await user.click(screen.getByLabelText('Indicator state field'));
    await user.click(screen.getByRole('option', { name: 'Signal' }));
    expect(snapshots[snapshots.length - 1]).toEqual({
      kind: OperandKind.IndicatorRef,
      instanceId: 'ind-a',
      stateKey: 'signal',
      valueType: StateValueType.String,
    });
  });

  it('derives the operand valueType to Number when the picked state field is numeric', async () => {
    const user = userEvent.setup();
    const snapshots: ConditionOperand[] = [];
    render(
      <Harness
        initial={{
          kind: OperandKind.IndicatorRef,
          instanceId: 'ind-a',
          stateKey: '',
          valueType: StateValueType.Number,
        }}
        indicators={[
          {
            id: 'ind-a',
            indicatorKey: 'supertrend',
            version: 1,
            inputs: {},
            summary: 'Supertrend',
          },
        ]}
        indicatorStateFieldsByKey={{ supertrend: SUPERTREND_FIELDS }}
        onSnapshot={(operand) => snapshots.push(operand)}
      />,
    );
    await user.click(screen.getByLabelText('Indicator state field'));
    await user.click(screen.getByRole('option', { name: 'Trend Value' }));
    expect(snapshots[snapshots.length - 1]).toEqual({
      kind: OperandKind.IndicatorRef,
      instanceId: 'ind-a',
      stateKey: 'value',
      valueType: StateValueType.Number,
    });
  });

  it("resets stateKey and valueType to the new indicator's first descriptor on instance switch", async () => {
    const user = userEvent.setup();
    const snapshots: ConditionOperand[] = [];
    render(
      <Harness
        initial={{
          kind: OperandKind.IndicatorRef,
          instanceId: 'ind-a',
          stateKey: 'signal',
          valueType: StateValueType.String,
        }}
        indicators={[
          {
            id: 'ind-a',
            indicatorKey: 'supertrend',
            version: 1,
            inputs: {},
            summary: 'Supertrend',
          },
          { id: 'ind-b', indicatorKey: 'sma', version: 1, inputs: {}, summary: 'SMA' },
        ]}
        indicatorStateFieldsByKey={{ supertrend: SUPERTREND_FIELDS, sma: SMA_FIELDS }}
        onSnapshot={(operand) => snapshots.push(operand)}
      />,
    );
    await user.click(screen.getByLabelText('Indicator instance'));
    await user.click(screen.getByRole('option', { name: 'SMA' }));
    expect(snapshots[snapshots.length - 1]).toEqual({
      kind: OperandKind.IndicatorRef,
      instanceId: 'ind-b',
      stateKey: 'value',
      valueType: StateValueType.Number,
    });
  });

  it('renders the IndicatorRef state-field Select even when the catalog has no entry for the key', () => {
    render(
      <Harness
        initial={{
          kind: OperandKind.IndicatorRef,
          instanceId: 'ind-a',
          stateKey: '',
          valueType: StateValueType.Number,
        }}
        indicators={[
          {
            id: 'ind-a',
            indicatorKey: 'supertrend',
            version: 1,
            inputs: {},
            summary: 'Supertrend',
          },
        ]}
        indicatorStateFieldsByKey={{ sma: SMA_FIELDS }}
      />,
    );
    expect(screen.getByLabelText('Indicator state field')).toBeDefined();
  });

  it('option-binds an enum-typed LHS RHS literal to the descriptor options, submitting the value', async () => {
    const user = userEvent.setup();
    const snapshots: ConditionOperand[] = [];
    render(
      <Harness
        initial={{ kind: OperandKind.Literal, value: { type: StateValueType.String, value: '' } }}
        literalValueType={StateValueType.String}
        literalEnumOptions={[
          { value: 'up', label: 'Up Trend' },
          { value: 'down', label: 'Down Trend' },
        ]}
        onSnapshot={(operand) => snapshots.push(operand)}
      />,
    );
    await user.click(screen.getByLabelText('Literal value'));
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['Up Trend', 'Down Trend']);
    await user.click(screen.getByRole('option', { name: 'Up Trend' }));
    expect(snapshots[snapshots.length - 1]).toEqual({
      kind: OperandKind.Literal,
      value: { type: StateValueType.String, value: 'up' },
    });
  });
});

const INDICATORS: IndicatorInstance[] = [
  {
    id: 'ind-a',
    indicatorKey: 'supertrend',
    version: 1,
    inputs: {},
    summary: 'Supertrend',
  },
  {
    id: 'ind-b',
    indicatorKey: 'sma',
    version: 1,
    inputs: {},
    summary: 'SMA',
  },
];

describe('filterIndicatorsByScope', () => {
  it('passes every indicator through when the rule scope is a single Symbol', () => {
    const result = filterIndicatorsByScope(
      INDICATORS,
      { kind: RuleScopeKind.Symbol, symbolId: 'crypto:BTCUSDT' },
      { type: ProfileScope.Symbols, symbolIds: ['crypto:ETHUSDT'] },
    );
    expect(result).toEqual(INDICATORS);
  });

  it('passes every indicator through when the rule scope is AllSymbols', () => {
    const result = filterIndicatorsByScope(
      INDICATORS,
      { kind: RuleScopeKind.AllSymbols },
      { type: ProfileScope.Symbols, symbolIds: ['crypto:ETHUSDT'] },
    );
    expect(result).toEqual(INDICATORS);
  });

  it('passes every indicator through for Symbols(list) when the profile scope is All', () => {
    const result = filterIndicatorsByScope(
      INDICATORS,
      { kind: RuleScopeKind.Symbols, symbolIds: ['crypto:BTCUSDT', 'crypto:ETHUSDT'] },
      { type: ProfileScope.All },
    );
    expect(result).toEqual(INDICATORS);
  });

  it('passes every indicator through for Symbols(list) when every selected id is in the profile scope', () => {
    const result = filterIndicatorsByScope(
      INDICATORS,
      { kind: RuleScopeKind.Symbols, symbolIds: ['crypto:BTCUSDT'] },
      { type: ProfileScope.Symbols, symbolIds: ['crypto:BTCUSDT', 'crypto:ETHUSDT'] },
    );
    expect(result).toEqual(INDICATORS);
  });

  it('returns an empty list for Symbols(list) when any selected id is outside the profile scope', () => {
    const result = filterIndicatorsByScope(
      INDICATORS,
      { kind: RuleScopeKind.Symbols, symbolIds: ['crypto:BTCUSDT', 'crypto:SOLUSDT'] },
      { type: ProfileScope.Symbols, symbolIds: ['crypto:BTCUSDT', 'crypto:ETHUSDT'] },
    );
    expect(result).toEqual([]);
  });

  it('passes every indicator through when the profile scope has not loaded yet', () => {
    const result = filterIndicatorsByScope(
      INDICATORS,
      { kind: RuleScopeKind.Symbols, symbolIds: ['crypto:BTCUSDT'] },
      undefined,
    );
    expect(result).toEqual(INDICATORS);
  });
});
