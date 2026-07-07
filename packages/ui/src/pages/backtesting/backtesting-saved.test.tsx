// @vitest-environment jsdom
import {
  type Backtest,
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
  RuleEventType,
  StateScope,
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
// loads under jsdom; the double exposes the candle / marker / overlay counts so
// the loaded backtest's rendering is observable.
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
  defaultPeriod: Period.OneDay,
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

const SAVED: Backtest = {
  id: 'b-1',
  name: 'Saved BTC run',
  status: BacktestStatus.Completed,
  createdAt: 1,
  updatedAt: 1,
  params: {
    symbolId: BTC.id,
    profileId: ALPHA.id,
    profileName: ALPHA.name,
    period: Period.OneHour,
    start: 1_000,
    end: 100_000,
    initialCapital: 10_000,
    commission: {},
  },
  strategyId: 's-1',
  strategy: STRATEGY,
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
      exitReason: BacktestExitReason.ProfitTarget,
    },
  ],
  summary: {
    totalPnl: 10,
    roiPct: 0.1,
    avgPnlPerTrade: 10,
    tradeCount: 1,
    winners: 1,
    losers: 0,
    avgRoiPct: 10,
    avgDaysInTrade: 0.03,
  },
};

function candle(time: number, close: number): Candle {
  return { type: SymbolType.Fx, time, open: close, high: close, low: close, close };
}

describe('BacktestingPage saved backtests', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    const fetchSpy = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes('/candles')) {
        return json({ candles: [candle(2_000, 100)], nextCursor: null, latestTime: 2_000 });
      }
      if (target.includes('/events')) {
        return json([
          {
            type: RuleEventType.StateSet,
            ts: 2_000,
            ruleId: 'r-1',
            symbolId: BTC.id,
            scope: StateScope.Symbol,
            key: 'go_long',
            value: { type: StateValueType.Bool, value: true },
          },
        ]);
      }
      if (target.includes('/backtests?status=completed')) return json([SAVED]);
      if (target.includes('/backtests?status=running')) return json([]);
      if (target.includes('/backtest-strategies')) return json([STRATEGY]);
      if (target.includes('/symbols?enrich=true')) return json([BTC]);
      if (target.includes('/config')) return json(CONFIG);
      if (target.includes('/profiles')) return json([ALPHA]);
      throw new Error(`unexpected fetch: ${target}`);
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  function json(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
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

  it('loads a saved backtest, locking the pickers and rendering its chart, overlays, and results without a run', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Alpha' });

    await user.click(await screen.findByRole('button', { name: 'Previous runs (1)' }));
    await user.click(await screen.findByRole('button', { name: 'Saved BTC run' }));

    // The chart fills from the candle store and the persisted trades/events.
    await waitFor(() =>
      expect(screen.getByTestId('backtest-chart')).toHaveTextContent('1 candles'),
    );
    const chart = screen.getByTestId('backtest-chart');
    const bar = screen.getByRole('group', { name: 'Backtesting actions' });
    const summary = screen.getByLabelText('Summary');
    expect({
      // Markers default off; overlays are never gated by the toggle.
      markers: chart.getAttribute('data-markers'),
      overlays: chart.getAttribute('data-overlays'),
      symbolLocked: within(bar).getByRole('button', { name: BTC.id }).hasAttribute('disabled'),
      periodLocked: within(bar)
        .getByRole('button', { name: Period.OneHour })
        .hasAttribute('disabled'),
      profileLocked: within(bar).getByRole('button', { name: 'Alpha' }).hasAttribute('disabled'),
      totalPnl: within(summary).getByText('Total P/L').previousElementSibling?.textContent,
      noRunForm: screen.queryByRole('button', { name: 'Run backtest' }) === null,
    }).toEqual({
      markers: '0',
      overlays: '1',
      symbolLocked: true,
      periodLocked: true,
      profileLocked: true,
      totalPnl: '+10.00',
      noRunForm: true,
    });
  });

  it('shows a Chart settings cog button once a saved backtest chart is rendered', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Alpha' });

    await user.click(await screen.findByRole('button', { name: 'Previous runs (1)' }));
    await user.click(await screen.findByRole('button', { name: 'Saved BTC run' }));
    await waitFor(() =>
      expect(screen.getByTestId('backtest-chart')).toHaveTextContent('1 candles'),
    );

    expect(screen.queryByRole('button', { name: 'Chart settings' }) !== null).toEqual(true);
  });

  it('passes the trade markers to the chart after toggling Show trade markers on', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Alpha' });

    await user.click(await screen.findByRole('button', { name: 'Previous runs (1)' }));
    await user.click(await screen.findByRole('button', { name: 'Saved BTC run' }));
    await waitFor(() =>
      expect(screen.getByTestId('backtest-chart')).toHaveTextContent('1 candles'),
    );

    await user.click(screen.getByRole('button', { name: 'Chart settings' }));
    await user.click(await screen.findByRole('switch', { name: 'Show trade markers' }));

    await waitFor(() =>
      expect(screen.getByTestId('backtest-chart').getAttribute('data-markers')).toEqual('2'),
    );
    expect(screen.getByTestId('backtest-chart').getAttribute('data-markers')).toEqual('2');
  });

  it('unlocks the pickers and re-enables the previous-runs trigger when the loaded backtest is closed', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Alpha' });

    await user.click(await screen.findByRole('button', { name: 'Previous runs (1)' }));
    await user.click(await screen.findByRole('button', { name: 'Saved BTC run' }));
    await user.click(await screen.findByRole('button', { name: 'Close' }));

    const bar = screen.getByRole('group', { name: 'Backtesting actions' });
    expect({
      symbolUnlocked: !within(bar).getByRole('button', { name: BTC.id }).hasAttribute('disabled'),
      previousRunsEnabled: !within(bar)
        .getByRole('button', { name: 'Previous runs (1)' })
        .hasAttribute('disabled'),
    }).toEqual({ symbolUnlocked: true, previousRunsEnabled: true });
  });
});
