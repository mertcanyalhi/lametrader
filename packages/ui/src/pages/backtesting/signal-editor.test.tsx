// @vitest-environment jsdom
import { type BacktestSignal, StateValueType } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SymbolStateKey } from '../../lib/hooks/state.js';
import { SignalEditor } from './signal-editor.js';

/**
 * A controlled harness that owns the signal state so edits round-trip through
 * `onChange` back into the component, and records each snapshot for assertions.
 */
function Harness({
  initial,
  knownKeys,
  onSnapshot,
}: {
  initial: BacktestSignal;
  knownKeys: SymbolStateKey[];
  onSnapshot?: (signal: BacktestSignal) => void;
}): ReactNode {
  const [value, setValue] = useState<BacktestSignal>(initial);
  return (
    <Theme>
      <SignalEditor
        value={value}
        knownKeys={knownKeys}
        ariaPrefix="Entry signal"
        onChange={(next) => {
          setValue(next);
          onSnapshot?.(next);
        }}
      />
    </Theme>
  );
}

const EMPTY: BacktestSignal = { key: '', value: { type: StateValueType.Number, value: 0 } };

describe('SignalEditor', () => {
  afterEach(() => {
    cleanup();
  });

  it('seeds the key combobox with the symbol state-key catalog', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={EMPTY}
        knownKeys={[
          { key: 'trend', valueType: StateValueType.String },
          { key: 'crossed', valueType: StateValueType.Bool },
        ]}
      />,
    );

    const input = screen.getByLabelText('Entry signal state key');
    await user.click(input);
    await user.keyboard('{ArrowDown}');

    expect({
      trend: screen.getByText('trend') !== null,
      crossed: screen.getByText('crossed') !== null,
    }).toEqual({ trend: true, crossed: true });
  });

  it('adopts a known key type and seeds its default value when the key is picked', async () => {
    const user = userEvent.setup();
    const snapshots: BacktestSignal[] = [];
    render(
      <Harness
        initial={EMPTY}
        knownKeys={[{ key: 'crossed', valueType: StateValueType.Bool }]}
        onSnapshot={(signal) => snapshots.push(signal)}
      />,
    );

    const input = screen.getByLabelText('Entry signal state key');
    await user.click(input);
    await user.click(screen.getByText('crossed'));

    expect(snapshots[snapshots.length - 1]).toEqual({
      key: 'crossed',
      value: { type: StateValueType.Bool, value: false },
    });
  });

  it('requires declaring a value type for a brand-new key not in the catalog', async () => {
    const user = userEvent.setup();
    const snapshots: BacktestSignal[] = [];
    render(<Harness initial={EMPTY} knownKeys={[]} onSnapshot={(s) => snapshots.push(s)} />);

    const input = screen.getByLabelText('Entry signal state key');
    await user.click(input);
    await user.keyboard('novel{Enter}');

    expect({
      snapshot: snapshots[snapshots.length - 1],
      hasValueTypeRow: screen.queryByLabelText('Entry signal value type') !== null,
    }).toEqual({
      snapshot: { key: 'novel', value: { type: StateValueType.Number, value: 0 } },
      hasValueTypeRow: true,
    });
  });

  it('renders a numeric field for a number-typed key', () => {
    render(
      <Harness
        initial={{ key: 'k', value: { type: StateValueType.Number, value: 5 } }}
        knownKeys={[{ key: 'k', valueType: StateValueType.Number }]}
      />,
    );

    expect(screen.getByRole('spinbutton', { name: 'Entry signal value' })).toBeInTheDocument();
  });

  it('renders a switch for a bool-typed key', () => {
    render(
      <Harness
        initial={{ key: 'k', value: { type: StateValueType.Bool, value: true } }}
        knownKeys={[{ key: 'k', valueType: StateValueType.Bool }]}
      />,
    );

    expect(screen.getByRole('switch', { name: 'Entry signal value' })).toBeInTheDocument();
  });

  it('renders a text field for a string-typed key', () => {
    render(
      <Harness
        initial={{ key: 'k', value: { type: StateValueType.String, value: 'long' } }}
        knownKeys={[{ key: 'k', valueType: StateValueType.String }]}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Entry signal value' })).toBeInTheDocument();
  });
});
