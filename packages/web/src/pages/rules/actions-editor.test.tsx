// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { type Action, ActionKind, StateValueType } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ActionsEditor } from './actions-editor';

function Harness({ initial }: { initial: Action[] }): ReactNode {
  const [value, setValue] = useState<Action[]>(initial);
  return (
    <Theme>
      <div data-testid="snapshot">{JSON.stringify(value)}</div>
      <ActionsEditor value={value} onChange={setValue} />
    </Theme>
  );
}

function snapshot(): Action[] {
  return JSON.parse(screen.getByTestId('snapshot').textContent ?? 'null');
}

describe('ActionsEditor', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the empty-state alert when the actions list is empty', () => {
    render(<Harness initial={[]} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Actions require at least one entry.');
  });

  it('appends a default SetSymbolState action when "+ Add state action" is clicked', async () => {
    render(<Harness initial={[]} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Add state action' }));

    expect(snapshot()).toEqual([
      {
        kind: ActionKind.SetSymbolState,
        key: '',
        value: { type: StateValueType.Number, value: 0 },
      },
    ]);
  });

  it('flips the kind to RemoveSymbolState when the operation radio switches to Remove', async () => {
    render(
      <Harness
        initial={[
          {
            kind: ActionKind.SetSymbolState,
            key: 'streak',
            value: { type: StateValueType.Number, value: 3 },
          },
        ]}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('radio', { name: 'Remove' }));

    expect(snapshot()).toEqual([{ kind: ActionKind.RemoveSymbolState, key: 'streak' }]);
  });

  it('flips the kind to SetGlobalState when the scope radio switches to Global', async () => {
    render(
      <Harness
        initial={[
          {
            kind: ActionKind.SetSymbolState,
            key: 'k',
            value: { type: StateValueType.Number, value: 0 },
          },
        ]}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('radio', { name: 'Global state' }));

    expect(snapshot()).toEqual([
      {
        kind: ActionKind.SetGlobalState,
        key: 'k',
        value: { type: StateValueType.Number, value: 0 },
      },
    ]);
  });

  it('switches the value editor when the value type is changed to Boolean', async () => {
    render(
      <Harness
        initial={[
          {
            kind: ActionKind.SetSymbolState,
            key: 'armed',
            value: { type: StateValueType.Number, value: 0 },
          },
        ]}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('combobox', { name: 'Action 1 value type' }));
    await user.click(screen.getByRole('option', { name: 'Boolean' }));

    expect(screen.getByRole('switch', { name: 'Action 1 value' })).toBeInTheDocument();
    expect(snapshot()).toEqual([
      {
        kind: ActionKind.SetSymbolState,
        key: 'armed',
        value: { type: StateValueType.Bool, value: false },
      },
    ]);
  });

  it('removes the action when the per-row Remove icon is clicked', async () => {
    render(
      <Harness
        initial={[
          {
            kind: ActionKind.SetSymbolState,
            key: 'k',
            value: { type: StateValueType.Number, value: 0 },
          },
        ]}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Remove action 1' }));

    expect(snapshot()).toEqual([]);
  });
});
