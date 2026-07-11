// @vitest-environment jsdom
import {
  type Backtest,
  BacktestExitReason,
  BacktestStatus,
  type Candle,
  Period,
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
import { createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelectedProfileProvider } from '../../src/lib/selected-profile-context.js';
import { ThemeProvider } from '../../src/lib/theme-context.js';
import { BacktestingPage } from '../../src/pages/backtesting/backtesting-page.js';

/**
 * The e2e project registers no `setupFiles`, so the jsdom shims the unit tier
 * gets from `src/test-setup.ts` are inlined here: `ResizeObserver`,
 * pointer-capture, `scrollIntoView`, and React's act-environment flag, all of
 * which Radix components touch while rendering.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
if (typeof Element.prototype.hasPointerCapture !== 'function') {
  Element.prototype.hasPointerCapture = (): boolean => false;
}
if (typeof Element.prototype.releasePointerCapture !== 'function') {
  Element.prototype.releasePointerCapture = (): void => undefined;
}
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = (): void => undefined;
}

// The reused chart is rendered as a lightweight double so lightweight-charts
// never loads under jsdom; the double exposes the candle count so the loaded
// backtest's chart fill is observable end-to-end.
vi.mock('../../src/pages/chart/candle-chart.js', () => ({
  CandleChart: ({ candles }: { candles: Candle[] }) =>
    h('div', { 'data-testid': 'backtest-chart' }, `${candles.length} candles`),
}));

// The Daily P&L histogram also loads lightweight-charts; render it as a double
// exposing the bucketed bar count so exit-day bucketing is observable.
vi.mock('../../src/pages/backtesting/daily-pnl-chart.js', () => ({
  DailyPnlChart: ({ bars }: { bars: unknown[] }) =>
    h('div', { 'data-testid': 'daily-pnl-chart' }, `${bars.length} bars`),
}));

const BTC = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'BTC / USDT',
  exchange: 'Binance',
  currency: 'USDT',
  periods: [Period.OneHour],
  quote: { price: 50000, change: 100, changePct: 0.002, period: Period.OneHour, time: 1000 },
};

const ALPHA = {
  id: 'p-alpha',
  name: 'Alpha',
  description: '',
  enabled: true,
  scope: { type: 'all' },
  createdAt: 1,
  updatedAt: 1,
  indicators: [],
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

/** `2021-01-01T00:00:00Z` — a UTC-midnight anchor for the run's trade timestamps. */
const DAY_0 = Date.UTC(2021, 0, 1);

const TRADE = {
  entryTs: DAY_0 + 1_000,
  exitTs: DAY_0 + 3_600_000,
  entryPrice: 100,
  exitPrice: 110,
  quantity: 2,
  commission: 1,
  pnl: 19,
  roiPct: 9.5,
  exitReason: BacktestExitReason.ProfitTarget,
};

const FINAL_SUMMARY = {
  totalPnl: 19,
  roiPct: 0.19,
  avgPnlPerTrade: 19,
  tradeCount: 1,
  winners: 1,
  losers: 0,
  avgRoiPct: 9.5,
  avgDaysInTrade: 0.5,
};

function candle(time: number, close: number): Candle {
  return { type: SymbolType.Crypto, time, open: close, high: close, low: close, close };
}

/**
 * End-to-end for the saved-backtests reload path from the end-user perspective:
 * it drives the real page — run a backtest to completion, reload the page (a
 * fresh mount + query cache), then reload the saved result from the panel — and
 * asserts the finished-run view (summary, trades, daily P&L) renders the same,
 * with no run started.
 *
 * The run publishes no stream (ADR-0022): the run's completion comes from polling
 * `GET /backtests/:id`, and both the just-finished run and the reloaded one render
 * through the same loaded path. Backed by a stateful in-memory fake of the REST
 * API (the completed backtest is persisted when the run finishes, as the server
 * would).
 */
describe('backtesting saved-reload flow (e2e)', () => {
  let strategies: Array<Record<string, unknown>>;
  let completed: Backtest[];
  // The mutable `GET /backtests/:id` poll document, flipped from running to
  // completed to drive the run to completion.
  let pollStatus: BacktestStatus;
  let pollProgress: { elapsedDays: number; totalDays: number };
  let pollTrades: unknown[];
  let pollSummary: typeof EMPTY_SUMMARY;

  beforeEach(() => {
    strategies = [];
    completed = [];
    pollStatus = BacktestStatus.Running;
    pollProgress = { elapsedDays: 1, totalDays: 2 };
    pollTrades = [];
    pollSummary = EMPTY_SUMMARY;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const target = String(url);
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      if (target.includes('/state-keys')) {
        return json([{ key: 'go_long', valueType: StateValueType.Bool }], 200);
      }
      if (method === 'POST' && target.includes('/backtest-strategies')) {
        const created = { id: 's-1', ...body, createdAt: 1, updatedAt: 1 };
        strategies.push(created);
        return json(created, 201);
      }
      if (target.includes('/backtest-strategies')) return json(strategies, 200);
      if (method === 'POST' && target.includes('/backtests')) {
        return json(
          {
            id: 'b-1',
            name: 'Saved run',
            status: BacktestStatus.Running,
            createdAt: 1,
            updatedAt: 1,
            params: PARAMS,
            strategyId: 's-1',
            strategy: strategies[0],
            trades: [],
            summary: EMPTY_SUMMARY,
          },
          202,
        );
      }
      if (target.includes('/backtests?status=completed')) return json(completed, 200);
      if (target.includes('/backtests?status=running')) return json([], 200);
      if (target.includes('/events')) {
        return json(
          [
            {
              type: RuleEventType.StateSet,
              ts: DAY_0 + 1_000,
              ruleId: 'r-1',
              symbolId: BTC.id,
              scope: StateScope.Symbol,
              key: 'go_long',
              value: { type: StateValueType.Bool, value: true },
            },
          ],
          200,
        );
      }
      if (target.includes('/candles')) {
        return json({ candles: [candle(1_000, 100)], nextCursor: null, latestTime: 1_000 }, 200);
      }
      if (target.includes('/symbols?enrich=true')) return json([BTC], 200);
      if (target.includes('/config'))
        return json({ periods: [Period.OneHour], defaultPeriod: Period.OneHour }, 200);
      if (target.includes('/profiles')) return json([ALPHA], 200);
      // The progress poll: `GET /backtests/:id` (no query, no sub-resource).
      if (/\/backtests\/[^/?]+$/.test(target)) {
        return json(
          {
            id: 'b-1',
            name: 'Saved run',
            status: pollStatus,
            createdAt: 1,
            updatedAt: 1,
            params: PARAMS,
            strategyId: 's-1',
            strategy: strategies[0],
            trades: pollTrades,
            summary: pollSummary,
            progress: pollProgress,
          },
          200,
        );
      }
      throw new Error(`unexpected fetch: ${method} ${target}`);
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  function json(bodyValue: unknown, status: number): Response {
    return new Response(status === 204 ? null : JSON.stringify(bodyValue), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function renderPage(): void {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      h(
        QueryClientProvider,
        { client: queryClient },
        h(
          Theme,
          null,
          h(ThemeProvider, null, h(SelectedProfileProvider, null, h(BacktestingPage))),
        ),
      ),
    );
  }

  it('runs a backtest, reloads the page, and loads the saved result with the same rendering', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Alpha' });

    // Create and run a strategy through the real editor + run form.
    await user.click(await screen.findByRole('button', { name: /New/ }));
    await user.type(await screen.findByLabelText('Strategy name'), 'Momentum');
    await user.click(screen.getByLabelText('Entry signal state key'));
    await user.click(await screen.findByText('go_long'));
    await user.click(screen.getByRole('checkbox', { name: 'Profit target' }));
    const amount = screen.getByLabelText('Profit target amount');
    await user.clear(amount);
    await user.type(amount, '10');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(strategies.length).toBe(1));
    await user.click(screen.getByRole('button', { name: 'Run backtest' }));
    await screen.findByText('Running — 50%');

    // The run finishes: the next poll reports completion, and the page flips into
    // the loaded view rendering the closed trade.
    pollStatus = BacktestStatus.Completed;
    pollProgress = { elapsedDays: 2, totalDays: 2 };
    pollTrades = [TRADE];
    pollSummary = FINAL_SUMMARY;
    const finishedSummary = await screen.findByLabelText('Summary', undefined, { timeout: 10_000 });
    expect(within(finishedSummary).getByText('Total P/L').previousElementSibling?.textContent).toBe(
      '+19.00',
    );

    // The server persists the completed backtest; make it reloadable.
    completed = [
      {
        id: 'b-1',
        name: 'Saved run',
        status: BacktestStatus.Completed,
        createdAt: 1,
        updatedAt: 1,
        params: PARAMS,
        strategyId: 's-1',
        strategy: strategies[0] as unknown as Backtest['strategy'],
        trades: [TRADE],
        summary: FINAL_SUMMARY,
      },
    ];

    // Reload the page: a fresh mount + empty query cache, as a browser reload.
    cleanup();
    renderPage();
    await screen.findByRole('button', { name: 'Alpha' });

    // Saved backtests now live behind the "Previous runs" bottom-bar modal —
    // open it before the saved run is reachable. No run is started.
    await user.click(await screen.findByRole('button', { name: /Previous runs/ }));
    await user.click(await screen.findByRole('button', { name: 'Saved run' }));

    await waitFor(() =>
      expect(screen.getByTestId('backtest-chart')).toHaveTextContent('1 candles'),
    );
    // Summary (active first) carries the merged metric block plus the Daily P&L
    // histogram shown by default.
    const summary = screen.getByLabelText('Summary');
    expect(within(summary).getByText('Total P/L').previousElementSibling?.textContent).toBe(
      '+19.00',
    );
    expect(within(summary).getByText('Winners / losers').previousElementSibling?.textContent).toBe(
      '1 / 0',
    );
    expect(screen.getByTestId('daily-pnl-chart')).toHaveTextContent('1 bars');
    expect(screen.queryByRole('button', { name: 'Run backtest' })).toBeNull();

    // Trades tab: the closed trade with its exit reason.
    await user.click(screen.getByRole('tab', { name: /Trades/ }));
    const tradeRows = within(screen.getByLabelText('Trades')).getAllByRole('row');
    expect(within(tradeRows[1] as HTMLElement).getByText('Profit target')).toBeInTheDocument();
  });
});
