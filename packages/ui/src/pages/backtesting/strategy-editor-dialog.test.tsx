// @vitest-environment jsdom
import { type BacktestStrategy, BacktestThresholdKind, StateValueType } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SymbolStateKey } from '../../lib/hooks/state.js';
import { StrategyEditorDialog } from './strategy-editor-dialog.js';

/** One recorded write against the strategies API. */
interface Call {
  method: string;
  url: string;
  body: unknown;
}

const CATALOG: SymbolStateKey[] = [
  { key: 'go_long', valueType: StateValueType.Bool },
  { key: 'exit_now', valueType: StateValueType.Bool },
];

const EXISTING: BacktestStrategy = {
  id: 's-1',
  name: 'Breakout',
  description: '',
  entry: { signal: { key: 'go_long', value: { type: StateValueType.Bool, value: true } } },
  exit: { profitTarget: { kind: BacktestThresholdKind.Fixed, amount: 5 } },
  createdAt: 1,
  updatedAt: 1,
};

describe('StrategyEditorDialog', () => {
  let queryClient: QueryClient;
  let calls: Call[];

  beforeEach(() => {
    calls = [];
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      if (String(url).includes('/state-keys')) {
        return new Response(JSON.stringify(CATALOG), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (String(url).includes('/backtest-strategies')) {
        calls.push({ method, url: String(url), body });
        const saved: BacktestStrategy = {
          ...EXISTING,
          ...(body as object),
          id: method === 'POST' ? 's-new' : EXISTING.id,
        };
        return new Response(JSON.stringify(saved), {
          status: method === 'POST' ? 201 : 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function renderDialog(props: {
    mode: 'create' | 'edit';
    initial?: BacktestStrategy;
    onSaved?: (strategy: BacktestStrategy) => void;
  }): void {
    render(
      <QueryClientProvider client={queryClient}>
        <Theme>
          <StrategyEditorDialog
            open
            onOpenChange={() => {}}
            mode={props.mode}
            initial={props.initial}
            symbolId="crypto:BTCUSDT"
            onSaved={props.onSaved}
          />
        </Theme>
      </QueryClientProvider>,
    );
  }

  it('keeps Save disabled when no exit mechanism is enabled', async () => {
    const user = userEvent.setup();
    renderDialog({ mode: 'create' });

    await user.type(screen.getByLabelText('Strategy name'), 'Breakout');
    const keyInput = screen.getByLabelText('Entry signal state key');
    await user.click(keyInput);
    await user.click(await screen.findByText('go_long'));

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('keeps Save disabled when the entry signal is unchecked', async () => {
    const user = userEvent.setup();
    renderDialog({ mode: 'create' });

    await user.type(screen.getByLabelText('Strategy name'), 'Breakout');
    await user.click(screen.getByRole('checkbox', { name: 'Profit target' }));
    await user.click(screen.getByRole('checkbox', { name: 'Entry signal' }));

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('creates the strategy when an entry signal and an exit mechanism are set', async () => {
    const user = userEvent.setup();
    const saved: BacktestStrategy[] = [];
    renderDialog({ mode: 'create', onSaved: (strategy) => saved.push(strategy) });

    await user.type(screen.getByLabelText('Strategy name'), 'Breakout');
    const keyInput = screen.getByLabelText('Entry signal state key');
    await user.click(keyInput);
    await user.click(await screen.findByText('go_long'));
    await user.click(screen.getByRole('checkbox', { name: 'Profit target' }));
    const amount = screen.getByLabelText('Profit target amount');
    await user.clear(amount);
    await user.type(amount, '5');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]).toEqual({
      method: 'POST',
      url: '/api/backtest-strategies',
      body: {
        name: 'Breakout',
        description: '',
        entry: { signal: { key: 'go_long', value: { type: StateValueType.Bool, value: false } } },
        exit: { profitTarget: { kind: BacktestThresholdKind.Fixed, amount: 5 } },
      },
    });
  });

  it('explains Fixed vs Percentage from the threshold kind info affordance', async () => {
    const user = userEvent.setup();
    renderDialog({ mode: 'create' });

    await user.click(screen.getByRole('checkbox', { name: 'Profit target' }));
    await user.click(screen.getByRole('button', { name: 'Profit target kind explanation' }));

    const hint = await screen.findByText(/absolute price offset from the entry price/i);
    expect(hint).toHaveTextContent(/percent of the entry price/i);
  });

  it('replaces the strategy via PUT when editing and saving', async () => {
    const user = userEvent.setup();
    renderDialog({ mode: 'edit', initial: EXISTING });

    const name = screen.getByLabelText('Strategy name');
    await user.clear(name);
    await user.type(name, 'Breakout v2');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]).toEqual({
      method: 'PUT',
      url: '/api/backtest-strategies/s-1',
      body: {
        name: 'Breakout v2',
        description: '',
        entry: { signal: { key: 'go_long', value: { type: StateValueType.Bool, value: true } } },
        exit: { profitTarget: { kind: BacktestThresholdKind.Fixed, amount: 5 } },
      },
    });
  });
});
