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
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviousRunsDialog, SavedBacktestsList } from './saved-backtests-list.js';

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

function backtest(
  id: string,
  name: string,
  overrides: { createdAt?: number; tradeCount?: number; totalPnl?: number } = {},
): Backtest {
  return {
    id,
    name,
    status: BacktestStatus.Completed,
    createdAt: overrides.createdAt ?? 1,
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
    summary: {
      ...SUMMARY,
      tradeCount: overrides.tradeCount ?? SUMMARY.tradeCount,
      totalPnl: overrides.totalPnl ?? SUMMARY.totalPnl,
    },
  };
}

/** Build `count` saved backtests named `Run 01`, `Run 02`, … for pagination tests. */
function manyBacktests(count: number): Backtest[] {
  return Array.from({ length: count }, (_, i) =>
    backtest(`b-${i}`, `Run ${String(i + 1).padStart(2, '0')}`, { createdAt: i + 1 }),
  );
}

/** The name cell text of each rendered table row, top to bottom (header row dropped). */
function renderedNameOrder(): (string | null)[] {
  const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
  return rows.map((row) => within(row).getAllByRole('cell')[0]?.textContent ?? null);
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

  it('renders a table row per backtest carrying its name, trade count, and P/L', async () => {
    store = [backtest('b-1', 'First run', { tradeCount: 3, totalPnl: 10 })];
    renderList();

    await screen.findByRole('button', { name: 'First run' });
    const row = within(screen.getByRole('table')).getAllByRole('row')[1];
    const cells = within(row as HTMLElement).getAllByRole('cell');
    expect({
      name: cells[0]?.textContent,
      trades: cells[2]?.textContent,
      pnl: cells[3]?.textContent,
    }).toEqual({ name: 'First run', trades: '3', pnl: '+10.00' });
  });

  it('orders the rows by created date descending by default', async () => {
    store = [
      backtest('b-1', 'Older run', { createdAt: 1 }),
      backtest('b-2', 'Newer run', { createdAt: 2 }),
    ];
    renderList();

    await screen.findByRole('button', { name: 'Older run' });
    expect(renderedNameOrder()).toEqual(['Newer run', 'Older run']);
  });

  it('sorts the rows by name ascending when the Name header is clicked', async () => {
    const user = userEvent.setup();
    store = [backtest('b-1', 'Bravo'), backtest('b-2', 'Alpha')];
    renderList();

    await screen.findByRole('button', { name: 'Bravo' });
    await user.click(screen.getByRole('button', { name: 'Name' }));

    expect(renderedNameOrder()).toEqual(['Alpha', 'Bravo']);
  });

  it('toggles the name sort to descending on a second Name header click', async () => {
    const user = userEvent.setup();
    store = [backtest('b-1', 'Bravo'), backtest('b-2', 'Alpha')];
    renderList();

    await screen.findByRole('button', { name: 'Bravo' });
    await user.click(screen.getByRole('button', { name: 'Name' }));
    await user.click(screen.getByRole('button', { name: 'Name' }));

    expect(renderedNameOrder()).toEqual(['Bravo', 'Alpha']);
  });

  it('reveals a second-page run after clicking Next', async () => {
    const user = userEvent.setup();
    store = manyBacktests(12);
    renderList();

    await screen.findByRole('button', { name: 'Run 12' });
    // Default created-desc order puts Run 01 (oldest) on the second page.
    expect(screen.queryByRole('button', { name: 'Run 01' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.queryByRole('button', { name: 'Run 01' })).not.toBeNull();
  });

  it('shows no pagination controls with a single page of runs', async () => {
    store = [backtest('b-1', 'First run'), backtest('b-2', 'Second run')];
    renderList();

    await screen.findByRole('button', { name: 'First run' });
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  });
});

describe('PreviousRunsDialog', () => {
  let queryClient: QueryClient;
  let store: Backtest[];

  beforeEach(() => {
    store = [backtest('b-1', 'First run'), backtest('b-2', 'Second run')];
    const fetchSpy = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes('/backtests?status=')) {
        return new Response(JSON.stringify(store), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch: ${target}`);
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function renderDialog(onLoad: (bt: Backtest) => void = () => {}): void {
    render(
      <QueryClientProvider client={queryClient}>
        <Theme>
          <PreviousRunsDialog onLoad={onLoad} />
        </Theme>
      </QueryClientProvider>,
    );
  }

  it('renders a Previous runs trigger labelled with the saved-backtests count', async () => {
    renderDialog();

    const trigger = await screen.findByRole('button', { name: 'Previous runs (2)' });

    expect({ label: trigger.getAttribute('aria-label') }).toEqual({
      label: 'Previous runs (2)',
    });
  });

  it('opens a modal listing the saved backtests when the trigger is clicked', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(await screen.findByRole('button', { name: 'Previous runs (2)' }));

    const dialog = await screen.findByRole('dialog');
    expect({
      first: within(dialog).queryByRole('button', { name: 'First run' }) !== null,
      second: within(dialog).queryByRole('button', { name: 'Second run' }) !== null,
    }).toEqual({ first: true, second: true });
  });

  it('renders a loading indicator instead of a 0 count while the count query is pending', async () => {
    // The count request never resolves, so the query stays pending.
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    renderDialog();

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Previous runs (loading)' })).not.toBeNull(),
    );
    expect(screen.queryByRole('button', { name: 'Previous runs (0)' })).toEqual(null);
  });
});
