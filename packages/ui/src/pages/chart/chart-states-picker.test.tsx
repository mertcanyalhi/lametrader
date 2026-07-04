// @vitest-environment jsdom
import { Theme } from '@radix-ui/themes';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChartStatesPicker } from './chart-states-picker';

afterEach(() => {
  cleanup();
});

/** Stateful wrapper: drives the controlled combobox and records every emitted value. */
function Harness({
  initial,
  options = [],
  onSnapshot,
}: {
  initial: string[];
  options?: string[];
  onSnapshot?: (next: string[]) => void;
}): ReactNode {
  const [value, setValue] = useState<string[]>(initial);
  return (
    <Theme>
      <ChartStatesPicker
        value={value}
        options={options}
        ariaLabel="Chart states"
        onChange={(next) => {
          setValue(next);
          onSnapshot?.(next);
        }}
      />
    </Theme>
  );
}

describe('ChartStatesPicker', () => {
  it('adds a suggested option as a chip, appending it to the current value', async () => {
    const user = userEvent.setup();
    const snapshots: string[][] = [];
    render(
      <Harness
        initial={['price:trend']}
        options={['price:trend', 'rsi:zone']}
        onSnapshot={(next) => snapshots.push(next)}
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Chart states' }));
    await user.click(screen.getByRole('option', { name: 'rsi:zone' }));
    expect(snapshots).toEqual([['price:trend', 'rsi:zone']]);
  });

  it('removes a chip via its remove control, dropping it from the value', async () => {
    const user = userEvent.setup();
    const snapshots: string[][] = [];
    render(
      <Harness
        initial={['price:trend', 'rsi:zone']}
        options={['price:trend', 'rsi:zone']}
        onSnapshot={(next) => snapshots.push(next)}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Remove price:trend' }));
    expect(snapshots).toEqual([['rsi:zone']]);
  });

  it('adds a free-text value not in the suggestions as a chip on Enter', async () => {
    const user = userEvent.setup();
    const snapshots: string[][] = [];
    render(
      <Harness
        initial={[]}
        options={['price:trend']}
        onSnapshot={(next) => snapshots.push(next)}
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Chart states' }));
    await user.keyboard('custom:key{Enter}');
    expect(snapshots).toEqual([['custom:key']]);
  });

  it('lists exactly the provided option keys in the menu', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[]} options={['price:trend', 'rsi:zone']} />);
    await user.click(screen.getByRole('combobox', { name: 'Chart states' }));
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['price:trend', 'rsi:zone']);
  });

  it('still adds a free-text chip when the options list is empty', async () => {
    const user = userEvent.setup();
    const snapshots: string[][] = [];
    render(<Harness initial={[]} options={[]} onSnapshot={(next) => snapshots.push(next)} />);
    await user.click(screen.getByRole('combobox', { name: 'Chart states' }));
    await user.keyboard('custom:key{Enter}');
    expect(snapshots).toEqual([['custom:key']]);
  });
});
