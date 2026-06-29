// @vitest-environment jsdom
import { type IndicatorInstance, RulesV2, StateValueType } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { OPERAND_KIND_OPTIONS, OperandPickerV2 } from './operand-picker-v2';

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
  initial: RulesV2.ConditionOperand;
  indicators?: IndicatorInstance[];
  symbolStateKeys?: string[];
  globalStateKeys?: string[];
  literalValueType?: StateValueType;
  onSnapshot?: (operand: RulesV2.ConditionOperand) => void;
}): ReactNode {
  const [value, setValue] = useState<RulesV2.ConditionOperand>(initial);
  return (
    <Theme>
      <OperandPickerV2
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

describe('OperandPickerV2', () => {
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
          kind: RulesV2.OperandKind.Literal,
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
          kind: RulesV2.OperandKind.Literal,
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
          kind: RulesV2.OperandKind.Literal,
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
          kind: RulesV2.OperandKind.SymbolStateRef,
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
