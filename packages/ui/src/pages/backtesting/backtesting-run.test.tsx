// @vitest-environment jsdom
import {
  BacktestExitReason,
  BacktestStatus,
  type BacktestStrategy,
  BacktestThresholdKind,
  type Candle,
  type Config,
  type EnrichedSymbol,
  Period,
  type Profile,
  ProfileScope,
  StateValueType,
  SymbolType,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelectedProfileProvider } from '../../lib/selected-profile-context.js';
import { ThemeProvider } from '../../lib/theme-context.js';
import { BacktestingPage } from './backtesting-page.js';

// Render the reused chart as a lightweight double so lightweight-charts never
// loads under jsdom; a completed run's chart renders from the loaded path.
vi.mock('../chart/candle-chart.js', () => ({
  CandleChart: ({ candles }: { candles: Candle[] }) => (
    <div data-testid="backtest-chart">{candles.length} candles</div>
  ),
}));

const BTC: EnrichedSymbol = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'BTC / USDT',
  exchange: 'Binance',
  currency: 'USDT',
  periods: [Period.OneHour, Period.OneDay],
  quote: { price: 50000, change: 100, changePct: 0.002, period: Period.OneDay, time: 1000 },
};

const CONFIG: Config = {
  periods: [Period.OneHour, Period.OneDay],
  defaultPeriod: Period.OneHour,
};

const ALPHA: Profile = {
  id: 'p-alpha',
  name: 'Alpha',
  description: '',
  enabled: true,
  scope: { type: ProfileScope.All },
  createdAt: 1,
  updatedAt: 1,
  indicators: [],
};

const STRATEGY: BacktestStrategy = {
  id: 's-1',
  name: 'Breakout',
  description: '',
  entry: { signal: { key: 'go_long', value: { type: StateValueType.Bool, value: true } } },
  exit: { profitTarget: { kind: BacktestThresholdKind.Fixed, amount: 5 } },
  createdAt: 1,
  updatedAt: 1,
};

const PARAMS = {
  symbolId: BTC.id,
  profileId: ALPHA.id,
  profileName: ALPHA.name,
  period: Period.OneHour,
  start: 1_000,
  end: 100_000,
  initialCapital: 10_000,
  commission: {},
};

const EMPTY_SUMMARY = {
  totalPnl: 0,
  roiPct: 0,
  avgPnlPerTrade: 0,
  tradeCount: 0,
  winners: 0,
  losers: 0,
  avgRoiPct: 0,
  avgDaysInTrade: 0,
};

const COMPLETED_SUMMARY = {
  totalPnl: 10,
  roiPct: 0.1,
  avgPnlPerTrade: 10,
  tradeCount: 1,
  winners: 1,
  losers: 0,
  avgRoiPct: 10,
  avgDaysInTrade: 0.03,
};

const TRADE = {
  entryTs: 2_000,
  exitTs: 5_000,
  entryPrice: 100,
  exitPrice: 110,
  quantity: 1,
  commission: 0,
  pnl: 10,
  roiPct: 10,
  exitReason: BacktestExitReason.ProfitTarget,
};

function candle(time: number, close: number): Candle {
  return { type: SymbolType.Fx, time, open: close, high: close, low: close, close };
}

/** A reattach discovery document — a run already in flight when the page loads. */
function runningBacktest(id: string): Record<string, unknown> {
  return {
    id,
    name: 'existing',
    status: BacktestStatus.Running,
    createdAt: 1,
    updatedAt: 1,
    params: PARAMS,
    strategyId: 's-1',
    strategy: STRATEGY,
    trades: [],
    summary: EMPTY_SUMMARY,
  };
}

describe('BacktestingPage run flow', () => {
  let queryClient: QueryClient;
  let runningList: unknown[];
  let deleted: string[];
  let storeCandles: Candle[];
  let watchlist: EnrichedSymbol[];
  // The mutable `GET /backtests/:id` poll document, flipped from running to
  // completed by a test to drive the run to completion.
  let pollStatus: BacktestStatus;
  let pollProgress: { elapsedDays: number; totalDays: number };
  let pollTrades: unknown[];
  let pollSummary: typeof EMPTY_SUMMARY;

  beforeEach(() => {
    runningList = [];
    deleted = [];
    storeCandles = [candle(1_000, 100)];
    watchlist = [BTC];
    pollStatus = BacktestStatus.Running;
    pollProgress = { elapsedDays: 1, totalDays: 2 };
    pollTrades = [];
    pollSummary = EMPTY_SUMMARY;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const target = String(url);
      if (method === 'DELETE') {
        const id = target.split('/').pop() ?? '';
        deleted.push(id);
        return new Response(null, { status: 204 });
      }
      if (method === 'POST' && target.includes('/backtests')) {
        return json(
          {
            id: 'b-1',
            name: 'run',
            status: BacktestStatus.Running,
            createdAt: 1,
            updatedAt: 1,
            params: PARAMS,
            strategyId: 's-1',
            strategy: STRATEGY,
            trades: [],
            summary: EMPTY_SUMMARY,
          },
          202,
        );
      }
      if (target.includes('/backtests?status=')) return json(runningList, 200);
      if (target.includes('/backtest-strategies')) return json([STRATEGY], 200);
      if (target.includes('/symbols?enrich=true')) return json(watchlist, 200);
      if (target.includes('/config')) return json(CONFIG, 200);
      if (target.includes('/profiles')) return json([ALPHA], 200);
      if (target.includes('/events')) return json([], 200);
      if (target.includes('/candles')) {
        const query = target.slice(target.indexOf('?'));
        const params = new URLSearchParams(query);
        const from = Number(params.get('from'));
        const to = Number(params.get('to'));
        const windowed = storeCandles.filter((c) => c.time >= from && c.time < to);
        return json({ candles: windowed, nextCursor: null, latestTime: 1_000 }, 200);
      }
      // The progress poll: `GET /backtests/:id` (no query, no sub-resource).
      if (/\/backtests\/[^/?]+$/.test(target)) {
        return json(pollResponse(target.split('/').pop() ?? ''), 200);
      }
      throw new Error(`unexpected fetch: ${method} ${target}`);
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  function json(body: unknown, status: number): Response {
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** The current poll response for a run id — its live status, progress, and results. */
  function pollResponse(id: string): Record<string, unknown> {
    return {
      id,
      name: 'run',
      status: pollStatus,
      createdAt: 1,
      updatedAt: 1,
      // A finished run carries an immutable completedAt; here 5m 3s after
      // createdAt, so the details' duration reads "5m 3s".
      ...(pollStatus === BacktestStatus.Completed ? { completedAt: 1 + 5 * 60_000 + 3_000 } : {}),
      params: PARAMS,
      strategyId: 's-1',
      strategy: STRATEGY,
      trades: pollTrades,
      summary: pollSummary,
      progress: pollProgress,
    };
  }

  function renderPage(): void {
    render(
      <QueryClientProvider client={queryClient}>
        <Theme>
          <ThemeProvider>
            <SelectedProfileProvider>
              <BacktestingPage />
            </SelectedProfileProvider>
          </ThemeProvider>
        </Theme>
      </QueryClientProvider>,
    );
  }

  async function selectStrategyAndRun(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(await screen.findByRole('combobox', { name: 'Selected strategy' }));
    await user.click(await screen.findByRole('option', { name: 'Breakout' }));
    await user.click(screen.getByRole('button', { name: 'Run backtest' }));
  }

  it('locks the symbol and profile pickers and shows the progress bar when a run starts', async () => {
    const user = userEvent.setup();
    renderPage();
    // Wait for the profile auto-select so the run has a profile.
    await screen.findByRole('button', { name: 'Alpha' });

    await selectStrategyAndRun(user);
    await screen.findByText('50%');

    const bar = screen.getByRole('group', { name: 'Backtesting actions' });
    expect({
      symbolLocked: within(bar).getByRole('button', { name: BTC.id }).hasAttribute('disabled'),
      profileLocked: within(bar).getByRole('button', { name: 'Alpha' }).hasAttribute('disabled'),
      progressbar: screen.getByRole('progressbar', { name: 'Run progress' }) !== null,
      progressText: screen.getByText('50%') !== null,
    }).toEqual({
      symbolLocked: true,
      profileLocked: true,
      progressbar: true,
      progressText: true,
    });
  });

  it('shows "Backtest in progress" in the chart region while a run polls, not the idle placeholder', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Alpha' });

    await selectStrategyAndRun(user);
    await screen.findByText('50%');

    expect({
      inProgress: screen.getByRole('heading', { name: 'Backtest in progress' }) !== null,
      idlePlaceholderGone: screen.queryByText('No backtest yet') === null,
      cancel: screen.getByRole('button', { name: 'Cancel run' }) !== null,
    }).toEqual({
      inProgress: true,
      idlePlaceholderGone: true,
      cancel: true,
    });
  });

  it("shows the started run's metadata (strategy, window, run time) while it polls", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Alpha' });

    await selectStrategyAndRun(user);

    const details = await screen.findByRole('region', { name: 'Run details' });
    expect({
      name: within(details).getByText('run') !== null,
      strategy: within(details).getByText('Breakout') !== null,
      viewStrategy: within(details).getByRole('button', { name: 'View strategy' }) !== null,
    }).toEqual({ name: true, strategy: true, viewStrategy: true });
  });

  it('keeps the period picker interactive while a run is active', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Alpha' });

    await selectStrategyAndRun(user);
    await screen.findByText('50%');

    const bar = screen.getByRole('group', { name: 'Backtesting actions' });
    expect(
      within(bar).getByRole('button', { name: Period.OneHour }).hasAttribute('disabled'),
    ).toEqual(false);
  });

  it('hides the strategy New action while a run is active', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Alpha' });

    await selectStrategyAndRun(user);
    await screen.findByText('50%');

    // A running run shows "Cancel run", so no /New/ button should exist — the
    // strategy New action is hidden.
    expect(screen.queryByRole('button', { name: /New/ })).toBeNull();
  });

  it('renders the completed run Summary and Trades via the loaded path once it finishes', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Alpha' });

    await selectStrategyAndRun(user);
    await screen.findByText('50%');

    // The run finishes: the next poll reports completion, and the page flips into
    // the loaded (completed) view — the chart and result tabs render from there.
    pollStatus = BacktestStatus.Completed;
    pollProgress = { elapsedDays: 2, totalDays: 2 };
    pollTrades = [TRADE];
    pollSummary = COMPLETED_SUMMARY;

    const summary = await screen.findByLabelText('Summary', undefined, { timeout: 5_000 });
    expect(within(summary).getByText('Total P/L').previousElementSibling?.textContent).toEqual(
      '+10.00',
    );

    await user.click(screen.getByRole('tab', { name: /Trades/ }));
    expect(within(screen.getByLabelText('Trades')).getByText('Profit target')).toBeInTheDocument();
  });

  it('shows "Completed at" with the timestamp and run duration once the run finishes', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Alpha' });

    await selectStrategyAndRun(user);
    await screen.findByText('50%');

    pollStatus = BacktestStatus.Completed;
    pollProgress = { elapsedDays: 2, totalDays: 2 };
    pollTrades = [TRADE];
    pollSummary = COMPLETED_SUMMARY;

    await screen.findByLabelText('Summary', undefined, { timeout: 5_000 });
    expect({
      label: screen.getByText('Completed at') !== null,
      value: screen.getByText('1970-01-01 00:05 (5m 3s)') !== null,
    }).toEqual({ label: true, value: true });
  });

  it('omits the "Completed at" row while the run is still running', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Alpha' });

    await selectStrategyAndRun(user);
    await screen.findByText('50%');

    expect(screen.queryByText('Completed at')).toEqual(null);
  });

  it('cancels a running run, discarding it and returning to idle', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Alpha' });

    await selectStrategyAndRun(user);
    await screen.findByText('50%');
    await user.click(screen.getByRole('button', { name: 'Cancel run' }));

    await waitFor(() => expect(deleted).toEqual(['b-1']));
    const bar = screen.getByRole('group', { name: 'Backtesting actions' });
    expect({
      backToForm: screen.getByRole('button', { name: 'Run backtest' }) !== null,
      symbolUnlocked: !within(bar).getByRole('button', { name: BTC.id }).hasAttribute('disabled'),
    }).toEqual({ backToForm: true, symbolUnlocked: true });
  });

  it('reattaches to an active run on load and restores its progress', async () => {
    runningList = [runningBacktest('b-9')];
    renderPage();

    const bar = await screen.findByRole('group', { name: 'Backtesting actions' });
    await screen.findByText('50%');
    expect({
      progress: screen.getByText('50%') !== null,
      symbolLocked: within(bar).getByRole('button', { name: BTC.id }).hasAttribute('disabled'),
    }).toEqual({ progress: true, symbolLocked: true });
  });

  it("restores the running run's strategy selection when reattaching on load", async () => {
    runningList = [runningBacktest('b-9')];
    renderPage();

    // A reattached run shows its metadata (not the setup selector); the Strategy
    // row names the run's strategy.
    const details = await screen.findByRole('region', { name: 'Run details' });
    await waitFor(() => expect(within(details).getByText('Breakout')).toBeInTheDocument());
    expect(within(details).getByText('Breakout')).toBeInTheDocument();
  });

  it('sets the tab title to the running symbol, progress, and total P/L while the run polls', async () => {
    pollSummary = { ...EMPTY_SUMMARY, totalPnl: 25, roiPct: 0.25, tradeCount: 1, winners: 1 };
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Alpha' });

    await selectStrategyAndRun(user);
    await screen.findByText('50%');

    expect(document.title).toEqual('crypto:BTCUSDT 50% +25.00 - lametrader');
  });

  it('opens on the last-used period from storage instead of the symbol smallest', async () => {
    window.localStorage.setItem('backtest-period', Period.OneDay);
    renderPage();

    const bar = await screen.findByRole('group', { name: 'Backtesting actions' });
    // BTC is watched on [1h, 1d] with 1h the smallest; the persisted 1d wins.
    expect(within(bar).queryByRole('button', { name: Period.OneDay }) !== null).toEqual(true);
  });

  it('persists the current period to storage so a later mount can restore it', async () => {
    renderPage();
    await screen.findByRole('group', { name: 'Backtesting actions' });

    // BTC's smallest watched period (1h) seeds the selection and is written
    // through — so a fresh mount (navigating back) reads it instead of a default.
    expect(window.localStorage.getItem('backtest-period')).toEqual(Period.OneHour);
  });
});
