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
    eventMarkers = [],
    stateOverlays = [],
  }: {
    candles: Candle[];
    eventMarkers?: unknown[];
    stateOverlays?: unknown[];
  }) => (
    <div
      data-testid="backtest-chart"
      data-markers={eventMarkers.length}
      data-overlays={stateOverlays.length}
    >
      {candles.length} candles
    </div>
  ),
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

  beforeEach(() => {
    onFrame = null;
    runningList = [];
    deleted = [];
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
        return json({ candles: [candle(1_000, 100)], nextCursor: null, latestTime: 1_000 }, 200);
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

  it('locks the pickers and shows the progress bar when a run starts', async () => {
    const user = userEvent.setup();
    renderPage();
    // Wait for the profile auto-select so the run has a profile.
    await screen.findByRole('button', { name: 'Alpha' });

    await selectStrategyAndRun(user);
    push(snapshot(1));

    const bar = screen.getByRole('group', { name: 'Backtesting actions' });
    expect({
      symbolLocked: within(bar).getByRole('button', { name: BTC.id }).hasAttribute('disabled'),
      periodLocked: within(bar)
        .getByRole('button', { name: Period.OneHour })
        .hasAttribute('disabled'),
      profileLocked: within(bar).getByRole('button', { name: 'Alpha' }).hasAttribute('disabled'),
      progressShown: screen.getByText('Running — 50%') !== null,
    }).toEqual({
      symbolLocked: true,
      periodLocked: true,
      profileLocked: true,
      progressShown: true,
    });
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
});
