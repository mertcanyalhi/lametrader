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
  knownStateKeys = { symbol: {}, global: {} },
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
        knownStateKeys={{
          symbol: {},
          global: {
            cycle: { type: StateValueType.Number, value: 0 },
            session: { type: StateValueType.String, value: '' },
          },
        }}
      />,
    );
    expect(screen.getByLabelText('Global state key')).toBeDefined();
  });

  it('renders a single Symbol state key combobox for RemoveSymbolState', () => {
    render(
      <Harness
        initial={[{ kind: ActionKind.RemoveSymbolState, key: '' }]}
        knownStateKeys={{
          symbol: { cooldown: { type: StateValueType.Number, value: 0 } },
          global: {},
        }}
      />,
    );
    expect(screen.getByLabelText('Symbol state key')).toBeDefined();
  });

  it('renders a single Global state key combobox for RemoveGlobalState', () => {
    render(
      <Harness
        initial={[{ kind: ActionKind.RemoveGlobalState, key: '' }]}
        knownStateKeys={{
          symbol: {},
          global: { cycle: { type: StateValueType.Number, value: 0 } },
        }}
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
        knownStateKeys={{ symbol: {}, global: {} }}
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
        knownStateKeys={{
          symbol: { a: { type: StateValueType.Number, value: 0 } },
          global: { b: { type: StateValueType.Bool, value: false } },
        }}
      />,
    );
    expect(screen.queryByLabelText('Symbol state key')).toEqual(null);
    expect(screen.queryByLabelText('Global state key')).toEqual(null);
    expect(screen.getByLabelText('Notification template')).toBeDefined();
  });
});

describe('ActionsPicker — SetState value type follows the picked key', () => {
  it('sets value.value.type + resets value.value.value when the user picks a known symbol-state key of a different type', async () => {
    const user = userEvent.setup();
    const snapshots: Action[][] = [];
    render(
      <Harness
        initial={[
          {
            kind: ActionKind.SetSymbolState,
            key: '',
            value: { type: StateValueType.String, value: '' },
          },
        ]}
        knownStateKeys={{
          symbol: {
            cooldown: { type: StateValueType.Number, value: 1800 },
          },
          global: {},
        }}
        onSnapshot={(actions) => snapshots.push(actions)}
      />,
    );
    const input = screen.getByLabelText('Symbol state key');
    await user.click(input);
    await user.click(screen.getByText('cooldown'));
    const last = snapshots[snapshots.length - 1];
    expect(last).toEqual([
      {
        kind: ActionKind.SetSymbolState,
        key: 'cooldown',
        value: { type: StateValueType.Number, value: 0 },
      },
    ]);
  });

  it('sets value.value.type + resets value.value.value when the user picks a known global-state key of a different type', async () => {
    const user = userEvent.setup();
    const snapshots: Action[][] = [];
    render(
      <Harness
        initial={[
          {
            kind: ActionKind.SetGlobalState,
            key: '',
            value: { type: StateValueType.Number, value: 0 },
          },
        ]}
        knownStateKeys={{
          symbol: {},
          global: {
            session: { type: StateValueType.String, value: 'us-open' },
          },
        }}
        onSnapshot={(actions) => snapshots.push(actions)}
      />,
    );
    const input = screen.getByLabelText('Global state key');
    await user.click(input);
    await user.click(screen.getByText('session'));
    const last = snapshots[snapshots.length - 1];
    expect(last).toEqual([
      {
        kind: ActionKind.SetGlobalState,
        key: 'session',
        value: { type: StateValueType.String, value: '' },
      },
    ]);
  });

  it('hides the Value type dropdown when the current key matches a known symbol-state key', () => {
    render(
      <Harness
        initial={[
          {
            kind: ActionKind.SetSymbolState,
            key: 'cooldown',
            value: { type: StateValueType.Number, value: 0 },
          },
        ]}
        knownStateKeys={{
          symbol: { cooldown: { type: StateValueType.Number, value: 1800 } },
          global: {},
        }}
      />,
    );
    expect(screen.queryByLabelText('State value type')).toEqual(null);
  });

  it('hides the Value type dropdown when the current key matches a known global-state key', () => {
    render(
      <Harness
        initial={[
          {
            kind: ActionKind.SetGlobalState,
            key: 'session',
            value: { type: StateValueType.String, value: '' },
          },
        ]}
        knownStateKeys={{
          symbol: {},
          global: { session: { type: StateValueType.String, value: 'us-open' } },
        }}
      />,
    );
    expect(screen.queryByLabelText('State value type')).toEqual(null);
  });

  it('shows the Value type dropdown when the SetSymbolState key is empty', () => {
    render(
      <Harness
        initial={[
          {
            kind: ActionKind.SetSymbolState,
            key: '',
            value: { type: StateValueType.String, value: '' },
          },
        ]}
        knownStateKeys={{
          symbol: { cooldown: { type: StateValueType.Number, value: 1800 } },
          global: {},
        }}
      />,
    );
    expect(screen.getByLabelText('State value type')).toBeDefined();
  });

  it('shows the Value type dropdown when the SetSymbolState key is a freetext-created key not present in the known map', () => {
    render(
      <Harness
        initial={[
          {
            kind: ActionKind.SetSymbolState,
            key: 'novel',
            value: { type: StateValueType.String, value: '' },
          },
        ]}
        knownStateKeys={{
          symbol: { cooldown: { type: StateValueType.Number, value: 1800 } },
          global: {},
        }}
      />,
    );
    expect(screen.getByLabelText('State value type')).toBeDefined();
  });

  it('renders a Switch (not a text input) for the value widget after picking a known Bool symbol-state key', async () => {
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
        knownStateKeys={{
          symbol: {
            activated: { type: StateValueType.Bool, value: true },
          },
          global: {},
        }}
      />,
    );
    const input = screen.getByLabelText('Symbol state key');
    await user.click(input);
    await user.click(screen.getByText('activated'));
    const stateValue = screen.getByLabelText('State value');
    expect(stateValue.getAttribute('role')).toEqual('switch');
  });
});
