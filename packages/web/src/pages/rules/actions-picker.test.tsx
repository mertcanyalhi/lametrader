// @vitest-environment jsdom
import { type Action, ActionKind, NotificationChannel, StateValueType } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { type ReactNode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionsPicker } from './actions-picker';
import type { KnownStateKeys } from './leaf-editor';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  // Telegram destinations hook fires a GET; return [].
  globalThis.fetch = vi.fn(
    async () =>
      new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ) as unknown as typeof fetch;
});

function Harness({
  initial,
  knownStateKeys = { symbol: [], global: [] },
  onSnapshot,
}: {
  initial: Action[];
  knownStateKeys?: KnownStateKeys;
  onSnapshot?: (actions: Action[]) => void;
}): ReactNode {
  const [value, setValue] = useState<Action[]>(initial);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <Theme>
        <ActionsPicker
          value={value}
          onChange={(next) => {
            setValue(next);
            onSnapshot?.(next);
          }}
          knownStateKeys={knownStateKeys}
        />
      </Theme>
    </QueryClientProvider>
  );
}

describe('ActionsPicker — state-key combobox', () => {
  it('exposes the known symbol-state keys as filterable options for SetSymbolState', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={[
          {
            kind: ActionKind.SetSymbolState,
            key: '',
            value: { type: StateValueType.String, value: '' },
          },
        ]}
        knownStateKeys={{ symbol: ['lastFiredAt', 'cooldown'], global: [] }}
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

  it('renders a single Global state key combobox for SetGlobalState', () => {
    render(
      <Harness
        initial={[
          {
            kind: ActionKind.SetGlobalState,
            key: '',
            value: { type: StateValueType.String, value: '' },
          },
        ]}
        knownStateKeys={{ symbol: [], global: ['cycle', 'session'] }}
      />,
    );
    expect(screen.getByLabelText('Global state key')).toBeDefined();
  });

  it('renders a single Symbol state key combobox for RemoveSymbolState', () => {
    render(
      <Harness
        initial={[{ kind: ActionKind.RemoveSymbolState, key: '' }]}
        knownStateKeys={{ symbol: ['cooldown'], global: [] }}
      />,
    );
    expect(screen.getByLabelText('Symbol state key')).toBeDefined();
  });

  it('renders a single Global state key combobox for RemoveGlobalState', () => {
    render(
      <Harness
        initial={[{ kind: ActionKind.RemoveGlobalState, key: '' }]}
        knownStateKeys={{ symbol: [], global: ['cycle'] }}
      />,
    );
    expect(screen.getByLabelText('Global state key')).toBeDefined();
  });

  it('writes a freshly-typed key through onCreateOption on Enter', async () => {
    const user = userEvent.setup();
    const snapshots: Action[][] = [];
    render(
      <Harness
        initial={[{ kind: ActionKind.RemoveSymbolState, key: '' }]}
        knownStateKeys={{ symbol: [], global: [] }}
        onSnapshot={(actions) => snapshots.push(actions)}
      />,
    );
    const input = screen.getByLabelText('Symbol state key');
    await user.click(input);
    await user.keyboard('novel{Enter}');
    const last = snapshots[snapshots.length - 1];
    expect(last).toEqual([{ kind: ActionKind.RemoveSymbolState, key: 'novel' }]);
  });

  it('leaves Notification rows unaffected by knownStateKeys', () => {
    render(
      <Harness
        initial={[
          {
            kind: ActionKind.Notification,
            channel: NotificationChannel.Telegram,
            destinationName: '',
            template: '',
          },
        ]}
        knownStateKeys={{ symbol: ['a'], global: ['b'] }}
      />,
    );
    expect(screen.queryByLabelText('Symbol state key')).toEqual(null);
    expect(screen.queryByLabelText('Global state key')).toEqual(null);
    expect(screen.getByLabelText('Notification template')).toBeDefined();
  });
});
