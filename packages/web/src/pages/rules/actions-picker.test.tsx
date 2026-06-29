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
  it('renders the StateKeyPicker dropdown + freetext fallback for SetSymbolState', async () => {
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
    // Both the dropdown trigger and the custom-text fallback share the label root.
    const trigger = screen.getByLabelText('Symbol state key');
    await user.click(trigger);
    expect(screen.getByText('lastFiredAt')).toBeDefined();
    expect(screen.getByText('cooldown')).toBeDefined();
    expect(screen.getByLabelText('Symbol state key (custom)')).toBeDefined();
  });

  it('renders the StateKeyPicker dropdown + freetext fallback for SetGlobalState', () => {
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
    expect(screen.getByLabelText('Global state key (custom)')).toBeDefined();
  });

  it('renders the StateKeyPicker for RemoveSymbolState', () => {
    render(
      <Harness
        initial={[{ kind: ActionKind.RemoveSymbolState, key: '' }]}
        knownStateKeys={{ symbol: ['cooldown'], global: [] }}
      />,
    );
    expect(screen.getByLabelText('Symbol state key')).toBeDefined();
    expect(screen.getByLabelText('Symbol state key (custom)')).toBeDefined();
  });

  it('renders the StateKeyPicker for RemoveGlobalState', () => {
    render(
      <Harness
        initial={[{ kind: ActionKind.RemoveGlobalState, key: '' }]}
        knownStateKeys={{ symbol: [], global: ['cycle'] }}
      />,
    );
    expect(screen.getByLabelText('Global state key')).toBeDefined();
    expect(screen.getByLabelText('Global state key (custom)')).toBeDefined();
  });

  it('writes the freetext value through to the action on change', async () => {
    const user = userEvent.setup();
    const snapshots: Action[][] = [];
    render(
      <Harness
        initial={[{ kind: ActionKind.RemoveSymbolState, key: '' }]}
        knownStateKeys={{ symbol: [], global: [] }}
        onSnapshot={(actions) => snapshots.push(actions)}
      />,
    );
    await user.type(screen.getByLabelText('Symbol state key (custom)'), 'novel');
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
