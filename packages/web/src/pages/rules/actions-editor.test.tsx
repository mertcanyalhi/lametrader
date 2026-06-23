// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { type Action, ActionKind, StateValueType } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionsEditor } from './actions-editor';

let queryClient: QueryClient;

function Harness({ initial }: { initial: Action[] }): ReactNode {
  const [value, setValue] = useState<Action[]>(initial);
  return (
    <QueryClientProvider client={queryClient}>
      <Theme>
        <div data-testid="snapshot">{JSON.stringify(value)}</div>
        <ActionsEditor value={value} onChange={setValue} />
      </Theme>
    </QueryClientProvider>
  );
}

function snapshot(): Action[] {
  return JSON.parse(screen.getByTestId('snapshot').textContent ?? 'null');
}

describe('ActionsEditor', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    globalThis.fetch = vi.fn(
      async () =>
        new Response('[]', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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

  it('appends a NotifyTelegram action when "Add telegram notification" is clicked', async () => {
    render(<Harness initial={[]} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Add telegram notification' }));

    expect(snapshot()).toEqual([
      { kind: ActionKind.NotifyTelegram, destinationName: '', template: '' },
    ]);
  });

  it('lists the destinations from `GET /notification/telegram/destinations` in the destination Select', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (String(url).endsWith('/notification/telegram/destinations')) {
        return new Response(JSON.stringify([{ name: 'main' }, { name: 'alerts' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('[]', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    render(
      <Harness
        initial={[{ kind: ActionKind.NotifyTelegram, destinationName: '', template: '' }]}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('combobox', { name: 'Action 1 destination' }));

    expect({
      main: screen.queryByRole('option', { name: 'main' }) !== null,
      alerts: screen.queryByRole('option', { name: 'alerts' }) !== null,
    }).toEqual({ main: true, alerts: true });
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
