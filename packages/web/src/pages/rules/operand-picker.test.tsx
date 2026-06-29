// @vitest-environment jsdom
import {
  type ConditionOperand,
  type IndicatorInstance,
  OperandKind,
  ProfileScope,
  RuleScopeKind,
  StateValueType,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { filterIndicatorsByScope, OPERAND_KIND_OPTIONS, OperandPicker } from './operand-picker';

afterEach(() => {
  cleanup();
});

/** A small wrapper for stateful render testing. */
function Harness({
  initial,
  indicators = [],
  symbolStateKeys = [],
  globalStateKeys = [],
  literalValueType,
  onSnapshot,
}: {
  initial: ConditionOperand;
  indicators?: IndicatorInstance[];
  symbolStateKeys?: string[];
  globalStateKeys?: string[];
  literalValueType?: StateValueType;
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
        symbolStateKeys={symbolStateKeys}
        globalStateKeys={globalStateKeys}
        literalValueType={literalValueType}
        ariaLabel="Left operand kind"
      />
    </Theme>
  );
}

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

  it('seeds the state-key dropdown with the known keys plus a freetext fallback', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{
          kind: OperandKind.SymbolStateRef,
          key: '',
          valueType: StateValueType.Number,
        }}
        symbolStateKeys={['lastFiredAt', 'cooldown']}
      />,
    );
    // The Radix Select trigger surfaces its options on open.
    const trigger = screen.getByLabelText('Symbol state key');
    await user.click(trigger);
    expect(screen.getByText('lastFiredAt')).toBeDefined();
    expect(screen.getByText('cooldown')).toBeDefined();
    expect(screen.getByLabelText('Symbol state key (custom)')).toBeDefined();
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
