// @vitest-environment jsdom
import {
  type Backtest,
  BacktestStatus,
  type BacktestStrategy,
  BacktestThresholdKind,
  Period,
  StateValueType,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SavedBacktestsList } from './saved-backtests-list.js';

const STRATEGY: BacktestStrategy = {
  id: 's-1',
  name: 'Breakout',
  description: '',
  entry: { signal: { key: 'go_long', value: { type: StateValueType.Bool, value: true } } },
  exit: { profitTarget: { kind: BacktestThresholdKind.Fixed, amount: 5 } },
  createdAt: 1,
  updatedAt: 1,
};

const SUMMARY = {
  totalPnl: 0,
  roiPct: 0,
  avgPnlPerTrade: 0,
  tradeCount: 0,
  winners: 0,
  losers: 0,
  avgRoiPct: 0,
  avgDaysInTrade: 0,
};

function backtest(id: string, name: string): Backtest {
  return {
    id,
    name,
    status: BacktestStatus.Completed,
    createdAt: 1,
    updatedAt: 1,
    params: {
      symbolId: 'crypto:BTCUSDT',
      profileId: 'p-alpha',
      profileName: 'Alpha',
      period: Period.OneHour,
      start: 1_000,
      end: 100_000,
      initialCapital: 10_000,
      commission: {},
    },
    strategyId: 's-1',
    strategy: STRATEGY,
    trades: [],
    summary: SUMMARY,
  };
}

describe('SavedBacktestsList', () => {
  let queryClient: QueryClient;
  let store: Backtest[];
  let patched: Array<{ id: string; body: unknown }>;
  let deleted: string[];

  beforeEach(() => {
    store = [backtest('b-1', 'First run'), backtest('b-2', 'Second run')];
    patched = [];
    deleted = [];
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const target = String(url);
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      if (target.includes('/backtests?status=')) return json(store, 200);
      const idMatch = target.match(/\/backtests\/([^/?]+)/);
      const id = idMatch ? decodeURIComponent(idMatch[1] ?? '') : '';
      if (method === 'PATCH') {
        patched.push({ id, body });
        store = store.map((entry) =>
          entry.id === id ? { ...entry, name: (body as { name: string }).name } : entry,
        );
        return json(
          store.find((entry) => entry.id === id),
          200,
        );
      }
      if (method === 'DELETE') {
        deleted.push(id);
        store = store.filter((entry) => entry.id !== id);
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected fetch: ${method} ${target}`);
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function json(bodyValue: unknown, status: number): Response {
    return new Response(JSON.stringify(bodyValue), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function renderList(onLoad: (bt: Backtest) => void = () => {}): void {
    render(
      <QueryClientProvider client={queryClient}>
        <Theme>
          <SavedBacktestsList onLoad={onLoad} />
        </Theme>
      </QueryClientProvider>,
    );
  }

  it('lists the completed backtests by name', async () => {
    renderList();

    await screen.findByRole('button', { name: 'First run' });
    expect({
      first: screen.getByRole('button', { name: 'First run' }) !== null,
      second: screen.getByRole('button', { name: 'Second run' }) !== null,
    }).toEqual({ first: true, second: true });
  });

  it('shows an empty hint when there are no saved backtests', async () => {
    store = [];
    renderList();

    expect(await screen.findByText('No saved backtests yet.')).toBeInTheDocument();
  });

  it('calls onLoad with the clicked backtest', async () => {
    const user = userEvent.setup();
    const loaded: Backtest[] = [];
    renderList((bt) => loaded.push(bt));

    await user.click(await screen.findByRole('button', { name: 'First run' }));

    expect(loaded).toEqual([backtest('b-1', 'First run')]);
  });

  it('renames a backtest through the API and refreshes the list', async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole('button', { name: 'Rename First run' }));
    const field = await screen.findByRole('textbox', { name: 'Backtest name' });
    await user.clear(field);
    await user.type(field, 'Renamed run');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Renamed run' })).not.toBeNull(),
    );
    expect(patched).toEqual([{ id: 'b-1', body: { name: 'Renamed run' } }]);
  });

  it('deletes a backtest through the API and refreshes the list', async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole('button', { name: 'Delete First run' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'First run' })).toBeNull());
    expect(deleted).toEqual(['b-1']);
  });
});
