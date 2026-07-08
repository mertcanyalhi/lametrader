// @vitest-environment jsdom
import {
  BacktestExitReason,
  type BacktestFrame,
  BacktestFrameKind,
  BacktestStatus,
  type Candle,
  type Config,
  type EnrichedSymbol,
  Period,
  type Profile,
  ProfileScope,
  RuleEventType,
  StateScope,
  StateValueType,
  SymbolType,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelectedProfileProvider } from '../../lib/selected-profile-context.js';
import { ThemeProvider } from '../../lib/theme-context.js';
import type { JsonSocketHandlers } from '../../lib/ws/json-socket.js';
import { BacktestingPage } from './backtesting-page.js';

// Render the reused chart as a lightweight double so lightweight-charts never
// loads under jsdom; the double exposes the candle count so incremental fill is
// observable.
vi.mock('../chart/candle-chart.js', () => ({
  CandleChart: ({
    candles,
    period,
    follow = false,
    eventMarkers = [],
    stateOverlays = [],
  }: {
    candles: Candle[];
    period: Period;
    follow?: boolean;
    eventMarkers?: unknown[];
    stateOverlays?: unknown[];
  }) => (
    <div
      data-testid="backtest-chart"
      data-period={period}
      data-follow={String(follow)}
      data-markers={eventMarkers.length}
      data-overlays={stateOverlays.length}
    >
      {candles.length} candles
    </div>
  ),
}));

// The idle chart (shown after a run ends) may fold a smaller period up over the
// shared stream client; stub it so no real socket is opened under jsdom.
vi.mock('../../lib/stream/stream-client.js', () => ({
  streamClient: {
    subscribe: () => () => {},
    onReconnect: () => () => {},
  },
}));

// Capture the run stream's frame handler so tests can push snapshot / delta
// frames, and count teardown.
let onFrame: ((frame: BacktestFrame) => void) | null;
vi.mock('../../lib/ws/json-socket.js', () => ({
  openJsonSocket: (_path: string, handlers: JsonSocketHandlers<BacktestFrame>) => {
    onFrame = handlers.onFrame;
    return { close: () => undefined };
  },
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

const STRATEGY = {
  id: 's-1',
  name: 'Breakout',
  description: '',
  entry: { signal: { key: 'go_long', value: { type: 'bool', value: true } } },
  exit: { profitTarget: { kind: 'fixed', amount: 5 } },
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

function candle(time: number, close: number): Candle {
  return { type: SymbolType.Fx, time, open: close, high: close, low: close, close };
}

function snapshot(progressElapsed: number): BacktestFrame {
  return {
    kind: BacktestFrameKind.Snapshot,
    status: BacktestStatus.Running,
    progress: { elapsedDays: progressElapsed, totalDays: 2 },
    params: PARAMS,
    trades: [],
    summary: EMPTY_SUMMARY,
    events: [],
  };
}

describe('BacktestingPage run flow', () => {
  let queryClient: QueryClient;
  let runningList: unknown[];
  let deleted: string[];
  let storeCandles: Candle[];

  beforeEach(() => {
    onFrame = null;
    runningList = [];
    deleted = [];
    storeCandles = [candle(1_000, 100)];
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
      if (target.includes('/symbols?enrich=true')) return json([BTC], 200);
      if (target.includes('/config')) return json(CONFIG, 200);
      if (target.includes('/profiles')) return json([ALPHA], 200);
      if (target.includes('/candles')) {
        const query = target.slice(target.indexOf('?'));
        const params = new URLSearchParams(query);
        const from = Number(params.get('from'));
        const to = Number(params.get('to'));
        const windowed = storeCandles.filter((c) => c.time >= from && c.time < to);
        return json({ candles: windowed, nextCursor: null, latestTime: 1_000 }, 200);
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
    await waitFor(() => expect(onFrame).not.toBeNull());
  }

  function push(frame: BacktestFrame): void {
    act(() => {
      onFrame?.(frame);
    });
  }

  it('locks the symbol and profile pickers and shows the progress bar when a run starts', async () => {
    const user = userEvent.setup();
    renderPage();
    // Wait for the profile auto-select so the run has a profile.
    await screen.findByRole('button', { name: 'Alpha' });

    await selectStrategyAndRun(user);
    push(snapshot(1));

    const bar = screen.getByRole('group', { name: 'Backtesting actions' });
    expect({
      symbolLocked: within(bar).getByRole('button', { name: BTC.id }).hasAttribute('disabled'),
      profileLocked: within(bar).getByRole('button', { name: 'Alpha' }).hasAttribute('disabled'),
      progressShown: screen.getByText('Running — 50%') !== null,
    }).toEqual({
      symbolLocked: true,
      profileLocked: true,
      progressShown: true,
    });
  });

  it('keeps the period picker interactive while a run is active', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Alpha' });

    await selectStrategyAndRun(user);
    push(snapshot(1));

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
    push(snapshot(1));

    // A running (not completed) run shows "Cancel run", so no /New/ button
    // should exist — the strategy New action is hidden.
    expect(screen.queryByRole('button', { name: /New/ })).toBeNull();
  });

  it('fills the chart incrementally from delta candle frames', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Alpha' });

    await selectStrategyAndRun(user);
    push(snapshot(0));
    push({
      kind: BacktestFrameKind.Delta,
      status: BacktestStatus.Running,
      progress: { elapsedDays: 1, totalDays: 2 },
      candles: [{ period: Period.OneHour, candle: candle(1_000, 100) }],
      events: [],
      trades: [],
      summary: EMPTY_SUMMARY,
      openPosition: undefined,
    });

    expect(screen.getByTestId('backtest-chart')).toHaveTextContent('1 candles');
  });

  it('draws trade markers on the chart by default from the frames, without any toggle', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Alpha' });

    await selectStrategyAndRun(user);
    push(snapshot(0));
    push({
      kind: BacktestFrameKind.Delta,
      status: BacktestStatus.Running,
      progress: { elapsedDays: 1, totalDays: 2 },
      candles: [],
      events: [
        {
          type: RuleEventType.StateSet,
          ts: 2_000,
          ruleId: 'r-1',
          symbolId: BTC.id,
          scope: StateScope.Symbol,
          key: 'go_long',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
      trades: [
        {
          entryTs: 2_000,
          exitTs: 5_000,
          entryPrice: 100,
          exitPrice: 110,
          quantity: 1,
          commission: 0,
          pnl: 10,
          roiPct: 10,
          exitReason: BacktestExitReason.Signal,
        },
      ],
      summary: EMPTY_SUMMARY,
      openPosition: undefined,
    });

    // Trade markers show by default; rule-event overlays are gated off.
    const chart = screen.getByTestId('backtest-chart');
    expect({
      markers: chart.getAttribute('data-markers'),
      overlays: chart.getAttribute('data-overlays'),
    }).toEqual({ markers: '2', overlays: '0' });
  });

  it('draws run-event state overlays on the chart after toggling Show rule events on', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Alpha' });

    await selectStrategyAndRun(user);
    push(snapshot(0));
    push({
      kind: BacktestFrameKind.Delta,
      status: BacktestStatus.Running,
      progress: { elapsedDays: 1, totalDays: 2 },
      candles: [],
      events: [
        {
          type: RuleEventType.StateSet,
          ts: 2_000,
          ruleId: 'r-1',
          symbolId: BTC.id,
          scope: StateScope.Symbol,
          key: 'go_long',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
      trades: [],
      summary: EMPTY_SUMMARY,
      openPosition: undefined,
    });

    await user.click(screen.getByRole('button', { name: 'Chart settings' }));
    await user.click(await screen.findByRole('switch', { name: 'Show rule events' }));

    const chart = screen.getByTestId('backtest-chart');
    await waitFor(() => expect(chart.getAttribute('data-overlays')).toEqual('1'));
    expect(chart.getAttribute('data-overlays')).toEqual('1');
  });

  it('charts the picked period over the run window, following the frontier, when switched mid-run', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Alpha' });

    await selectStrategyAndRun(user);
    push(snapshot(1));
    // The run streams at 1h, so the chart opens on 1h.
    expect(screen.getByTestId('backtest-chart').getAttribute('data-period')).toEqual(
      Period.OneHour,
    );

    // Switching the (still-live) picker to 1d re-charts that period from the store
    // over the run's window and keeps following the frontier bar — it does not
    // stay pinned to the run's 1h, nor jump to present-day candles.
    const bar = screen.getByRole('group', { name: 'Backtesting actions' });
    await user.click(within(bar).getByRole('button', { name: Period.OneHour }));
    await user.click(await screen.findByRole('button', { name: Period.OneDay }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(screen.getByTestId('backtest-chart').getAttribute('data-period')).toEqual(
        Period.OneDay,
      ),
    );
    // The 1d candle lives inside the run window [1_000, 100_000); reading that
    // window (not a present-day one) surfaces it, so the chart shows 1 candle.
    const chart = screen.getByTestId('backtest-chart');
    expect({
      period: chart.getAttribute('data-period'),
      follow: chart.getAttribute('data-follow'),
      candles: chart.textContent,
    }).toEqual({ period: Period.OneDay, follow: 'true', candles: '1 candles' });
  });

  it('keeps the switched period on the chart after the run is cancelled, without reverting', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Alpha' });

    await selectStrategyAndRun(user);
    push(snapshot(1));
    const bar = screen.getByRole('group', { name: 'Backtesting actions' });
    await user.click(within(bar).getByRole('button', { name: Period.OneHour }));
    await user.click(await screen.findByRole('button', { name: Period.OneDay }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(screen.getByTestId('backtest-chart').getAttribute('data-period')).toEqual(
        Period.OneDay,
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Cancel run' }));

    // Cancelling returns to idle but keeps the chart on the picked 1d — it does
    // not snap back to the run's 1h.
    await waitFor(() => expect(deleted).toEqual(['b-1']));
    expect(screen.getByTestId('backtest-chart').getAttribute('data-period')).toEqual(Period.OneDay);
  });

  it('reports completion on the final frame', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Alpha' });

    await selectStrategyAndRun(user);
    push(snapshot(0));
    push({
      kind: BacktestFrameKind.Delta,
      status: BacktestStatus.Completed,
      progress: { elapsedDays: 2, totalDays: 2 },
      candles: [],
      events: [],
      trades: [],
      summary: EMPTY_SUMMARY,
      openPosition: undefined,
    });

    expect({
      complete: screen.getByText('Run complete') !== null,
      newRun: screen.getByRole('button', { name: 'New run' }) !== null,
    }).toEqual({ complete: true, newRun: true });
  });

  it('cancels a running run, discarding it and returning to idle', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Alpha' });

    await selectStrategyAndRun(user);
    push(snapshot(1));
    await user.click(screen.getByRole('button', { name: 'Cancel run' }));

    await waitFor(() => expect(deleted).toEqual(['b-1']));
    const bar = screen.getByRole('group', { name: 'Backtesting actions' });
    expect({
      backToForm: screen.getByRole('button', { name: 'Run backtest' }) !== null,
      symbolUnlocked: !within(bar).getByRole('button', { name: BTC.id }).hasAttribute('disabled'),
    }).toEqual({ backToForm: true, symbolUnlocked: true });
  });

  it('reattaches to an active run on load and restores its progress', async () => {
    runningList = [
      {
        id: 'b-9',
        name: 'existing',
        status: BacktestStatus.Running,
        createdAt: 1,
        updatedAt: 1,
        params: PARAMS,
        strategyId: 's-1',
        strategy: STRATEGY,
        trades: [],
        summary: EMPTY_SUMMARY,
      },
    ];
    renderPage();

    await waitFor(() => expect(onFrame).not.toBeNull());
    push(snapshot(1));

    const bar = await screen.findByRole('group', { name: 'Backtesting actions' });
    expect({
      progress: screen.getByText('Running — 50%') !== null,
      symbolLocked: within(bar).getByRole('button', { name: BTC.id }).hasAttribute('disabled'),
    }).toEqual({ progress: true, symbolLocked: true });
  });

  it("restores the running run's strategy selection when reattaching on load", async () => {
    runningList = [
      {
        id: 'b-9',
        name: 'existing',
        status: BacktestStatus.Running,
        createdAt: 1,
        updatedAt: 1,
        params: PARAMS,
        strategyId: 's-1',
        strategy: STRATEGY,
        trades: [],
        summary: EMPTY_SUMMARY,
      },
    ];
    renderPage();

    await waitFor(() => expect(onFrame).not.toBeNull());
    push(snapshot(1));

    const trigger = await screen.findByRole('combobox', { name: 'Selected strategy' });
    await waitFor(() => expect(trigger).toHaveTextContent('Breakout'));
    expect(trigger).toHaveTextContent('Breakout');
  });

  it('catches the reattached chart up only to the replay frontier, not the whole run window', async () => {
    const DAY = 86_400_000;
    const reattachParams = { ...PARAMS, period: Period.OneDay, start: 0, end: 10 * DAY };
    storeCandles = Array.from({ length: 10 }, (_, i) => candle(i * DAY, 100 + i));
    runningList = [
      {
        id: 'b-9',
        name: 'existing',
        status: BacktestStatus.Running,
        createdAt: 1,
        updatedAt: 1,
        params: reattachParams,
        strategyId: 's-1',
        strategy: STRATEGY,
        trades: [],
        summary: EMPTY_SUMMARY,
      },
    ];
    renderPage();
    await waitFor(() => expect(onFrame).not.toBeNull());

    // Frontier at reattach = 3 elapsed days → catch-up reads only [0, 3·DAY): 3 bars.
    push({
      kind: BacktestFrameKind.Snapshot,
      status: BacktestStatus.Running,
      progress: { elapsedDays: 3, totalDays: 10 },
      params: reattachParams,
      trades: [],
      summary: EMPTY_SUMMARY,
      events: [],
    });

    const chart = await screen.findByTestId('backtest-chart');
    await waitFor(() => expect(chart).toHaveTextContent('3 candles'));
    expect(chart).toHaveTextContent('3 candles');
  });

  it('keeps following the frontier as a delta frame extends the reattached chart', async () => {
    const DAY = 86_400_000;
    const reattachParams = { ...PARAMS, period: Period.OneDay, start: 0, end: 10 * DAY };
    storeCandles = Array.from({ length: 10 }, (_, i) => candle(i * DAY, 100 + i));
    runningList = [
      {
        id: 'b-9',
        name: 'existing',
        status: BacktestStatus.Running,
        createdAt: 1,
        updatedAt: 1,
        params: reattachParams,
        strategyId: 's-1',
        strategy: STRATEGY,
        trades: [],
        summary: EMPTY_SUMMARY,
      },
    ];
    renderPage();
    await waitFor(() => expect(onFrame).not.toBeNull());
    push({
      kind: BacktestFrameKind.Snapshot,
      status: BacktestStatus.Running,
      progress: { elapsedDays: 3, totalDays: 10 },
      params: reattachParams,
      trades: [],
      summary: EMPTY_SUMMARY,
      events: [],
    });
    const chart = await screen.findByTestId('backtest-chart');
    await waitFor(() => expect(chart).toHaveTextContent('3 candles'));

    // A delta frame past the frontier extends the caught-up window, so the chart
    // grows and stays in follow mode instead of freezing on the fetched tail.
    push({
      kind: BacktestFrameKind.Delta,
      status: BacktestStatus.Running,
      progress: { elapsedDays: 4, totalDays: 10 },
      candles: [{ period: Period.OneDay, candle: candle(3 * DAY, 200) }],
      events: [],
      trades: [],
      summary: EMPTY_SUMMARY,
      openPosition: undefined,
    });

    expect({
      candles: chart.textContent,
      follow: chart.getAttribute('data-follow'),
    }).toEqual({ candles: '4 candles', follow: 'true' });
  });

  it('sets the tab title to the running symbol, progress, and total P/L while a run streams', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Alpha' });

    await selectStrategyAndRun(user);
    push(snapshot(0));
    push({
      kind: BacktestFrameKind.Delta,
      status: BacktestStatus.Running,
      progress: { elapsedDays: 1, totalDays: 2 },
      candles: [],
      events: [],
      trades: [],
      summary: { ...EMPTY_SUMMARY, totalPnl: 25, roiPct: 0.25, tradeCount: 1, winners: 1 },
      openPosition: undefined,
    });

    expect(document.title).toEqual('crypto:BTCUSDT 50% +25.00 - lametrader');
  });

  it('shows 100% and the final total P/L in the tab title once the run completes', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Alpha' });

    await selectStrategyAndRun(user);
    push(snapshot(0));
    // A completed frame pins the title to 100% even if its progress trails, and
    // carries the run's final total P/L.
    push({
      kind: BacktestFrameKind.Delta,
      status: BacktestStatus.Completed,
      progress: { elapsedDays: 1, totalDays: 2 },
      candles: [],
      events: [],
      trades: [],
      summary: { ...EMPTY_SUMMARY, totalPnl: -12.5, roiPct: -0.125, tradeCount: 1, losers: 1 },
      openPosition: undefined,
    });

    expect(document.title).toEqual('crypto:BTCUSDT 100% -12.50 - lametrader');
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
