// @vitest-environment jsdom
import { type BacktestStrategy, BacktestThresholdKind, StateValueType } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrategyManager } from './strategy-manager.js';

function strategy(id: string, name: string): BacktestStrategy {
  return {
    id,
    name,
    description: '',
    entry: { signal: { key: 'go_long', value: { type: StateValueType.Bool, value: true } } },
    exit: { profitTarget: { kind: BacktestThresholdKind.Fixed, amount: 5 } },
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('StrategyManager', () => {
  let queryClient: QueryClient;
  let store: BacktestStrategy[];
  let deleted: string[];

  beforeEach(() => {
    store = [strategy('s-1', 'Breakout'), strategy('s-2', 'Mean reversion')];
    deleted = [];
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const target = String(url);
      if (target.includes('/state-keys')) return json([]);
      if (target.includes('/backtest-strategies')) {
        const idMatch = target.match(/\/backtest-strategies\/(.+)$/);
        if (method === 'GET') return json(store);
        if (method === 'DELETE' && idMatch) {
          const id = decodeURIComponent(idMatch[1] ?? '');
          deleted.push(id);
          store = store.filter((entry) => entry.id !== id);
          return new Response(null, { status: 204 });
        }
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

  function json(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function renderManager(disabled = false): void {
    render(
      <QueryClientProvider client={queryClient}>
        <Theme>
          <StrategyManager symbolId="crypto:BTCUSDT" disabled={disabled} />
        </Theme>
      </QueryClientProvider>,
    );
  }

  it('lists the saved strategies as selector options', async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(await screen.findByRole('combobox', { name: 'Selected strategy' }));

    expect({
      breakout: screen.getByRole('option', { name: 'Breakout' }) !== null,
      meanReversion: screen.getByRole('option', { name: 'Mean reversion' }) !== null,
    }).toEqual({ breakout: true, meanReversion: true });
  });

  it('opens the create dialog from the New button', async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(await screen.findByRole('button', { name: /New/ }));

    expect(await screen.findByRole('dialog')).toHaveTextContent('New strategy');
  });

  it('hides the edit control when no strategy is selected', async () => {
    renderManager();

    await screen.findByRole('combobox', { name: 'Selected strategy' });

    expect(screen.queryByRole('button', { name: 'Edit strategy' })).toEqual(null);
  });

  it('shows the edit control once a strategy is selected', async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(await screen.findByRole('combobox', { name: 'Selected strategy' }));
    await user.click(screen.getByRole('option', { name: 'Breakout' }));

    expect(screen.getByRole('button', { name: 'Edit strategy' }) !== null).toEqual(true);
  });

  it('opens the edit dialog seeded with the selected strategy', async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(await screen.findByRole('combobox', { name: 'Selected strategy' }));
    await user.click(screen.getByRole('option', { name: 'Breakout' }));
    await user.click(screen.getByRole('button', { name: 'Edit strategy' }));

    expect(await screen.findByLabelText('Strategy name')).toHaveValue('Breakout');
  });

  it('keeps the New button enabled when idle', async () => {
    renderManager();

    const newButton = await screen.findByRole('button', { name: /New/ });

    expect(newButton).toBeEnabled();
  });

  it('hides the New button when disabled (a backtest is running)', async () => {
    renderManager(true);

    // The selector still renders (strategies can be browsed), so wait on it.
    await screen.findByRole('combobox', { name: 'Selected strategy' });

    expect(screen.queryByRole('button', { name: /New/ })).toBeNull();
  });

  it('hides the edit control when disabled (a backtest is running)', async () => {
    const user = userEvent.setup();
    renderManager(true);

    await user.click(await screen.findByRole('combobox', { name: 'Selected strategy' }));
    await user.click(screen.getByRole('option', { name: 'Breakout' }));

    expect(screen.queryByRole('button', { name: 'Edit strategy' })).toEqual(null);
  });

  it('deletes the selected strategy from the edit dialog and drops it from the selector', async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(await screen.findByRole('combobox', { name: 'Selected strategy' }));
    await user.click(screen.getByRole('option', { name: 'Breakout' }));
    await user.click(screen.getByRole('button', { name: 'Edit strategy' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleted).toEqual(['s-1']));
    await user.click(screen.getByRole('combobox', { name: 'Selected strategy' }));
    await waitFor(() => expect(screen.queryByRole('option', { name: 'Breakout' })).toBeNull());
  });
});
