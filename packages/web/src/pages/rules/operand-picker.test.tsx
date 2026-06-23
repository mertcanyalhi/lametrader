// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  type ConditionOperand,
  type IndicatorInstance,
  OperandKind,
  StateValueType,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { OperandPicker } from './operand-picker';

const SMA: IndicatorInstance = {
  id: 'ind-sma',
  indicatorKey: 'sma',
  version: 1,
  inputs: { period: 14 },
  label: undefined,
  summary: 'SMA 14',
};

function Harness({
  initial,
  indicators = [SMA],
}: {
  initial: ConditionOperand;
  indicators?: IndicatorInstance[];
}): ReactNode {
  const [value, setValue] = useState<ConditionOperand>(initial);
  return (
    <Theme>
      <div data-testid="snapshot">{JSON.stringify(value)}</div>
      <OperandPicker
        value={value}
        onChange={setValue}
        indicators={indicators}
        ariaLabel="Left operand kind"
      />
    </Theme>
  );
}

function snapshot(): ConditionOperand {
  return JSON.parse(screen.getByTestId('snapshot').textContent ?? 'null');
}

describe('OperandPicker', () => {
  afterEach(() => {
    cleanup();
  });

  it('switches to a bar-quote operand when "Current" is picked', async () => {
    render(
      <Harness
        initial={{ kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } }}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('combobox', { name: 'Left operand kind' }));
    await user.click(screen.getByRole('option', { name: 'Current' }));

    expect(snapshot()).toEqual({
      kind: OperandKind.CurrentValue,
      valueType: StateValueType.Number,
    });
  });

  it('renders the profile indicator dropdown when IndicatorRef is selected', async () => {
    render(
      <Harness
        initial={{
          kind: OperandKind.IndicatorRef,
          instanceId: '',
          stateKey: '',
          valueType: StateValueType.Number,
        }}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('combobox', { name: 'Left operand kind indicator' }));

    expect(screen.getByRole('option', { name: 'SMA 14' })).toBeInTheDocument();
  });

  it('updates the symbol-state key as the user types it', async () => {
    render(
      <Harness
        initial={{
          kind: OperandKind.SymbolStateRef,
          key: '',
          valueType: StateValueType.Number,
        }}
      />,
    );
    const user = userEvent.setup();

    await user.type(screen.getByRole('textbox', { name: 'Left operand kind state key' }), 'streak');

    expect(snapshot()).toEqual({
      kind: OperandKind.SymbolStateRef,
      key: 'streak',
      valueType: StateValueType.Number,
    });
  });

  it('renders a checkbox-style input and writes a boolean literal when value type is Boolean', async () => {
    render(
      <Harness
        initial={{ kind: OperandKind.Literal, value: { type: StateValueType.Bool, value: false } }}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('switch', { name: 'Left operand kind value' }));

    expect(snapshot()).toEqual({
      kind: OperandKind.Literal,
      value: { type: StateValueType.Bool, value: true },
    });
  });
});
