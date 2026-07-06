// @vitest-environment jsdom
import {
  type BacktestFrame,
  BacktestFrameKind,
  BacktestStatus,
  type Candle,
  Period,
  StateValueType,
  SymbolType,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
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
// never loads under jsdom; the double exposes the candle count so the run's
// incremental fill is observable end-to-end.
vi.mock('../../src/pages/chart/candle-chart.js', () => ({
  CandleChart: ({ candles }: { candles: Candle[] }) =>
    h('div', { 'data-testid': 'backtest-chart' }, `${candles.length} candles`),
}));

// The run stream stands in for the per-run WebSocket: capture the frame handler
// so the test drives the run to completion by pushing snapshot + delta frames.
const socket = vi.hoisted(() => ({ onFrame: null as null | ((frame: BacktestFrame) => void) }));
vi.mock('../../src/lib/ws/json-socket.js', () => ({
  openJsonSocket: (_path: string, handlers: { onFrame: (frame: BacktestFrame) => void }) => {
    socket.onFrame = handlers.onFrame;
    return {
      close: () => {
        socket.onFrame = null;
      },
    };
  },
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

function candle(time: number, close: number): Candle {
  return { type: SymbolType.Fx, time, open: close, high: close, low: close, close };
}

/**
 * End-to-end for the `/backtesting` run flow from the end-user perspective: it
 * drives the real page — create a strategy, run it, watch progress advance, and
 * reach completion — against a stateful in-memory fake of the REST API plus a
 * controllable stand-in for the per-run stream.
 *
 * Covers the issue's `create-strategy → run → progress → completion` path; the
 * live full-stack path (real Mongo + a real run) is exercised by the backend
 * e2e.
 */
describe('backtesting run flow (e2e)', () => {
  let strategies: Array<Record<string, unknown>>;
  let posted: unknown[];

  beforeEach(() => {
    strategies = [];
    posted = [];
    socket.onFrame = null;
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
        posted.push(body);
        return json(
          {
            id: 'b-1',
            name: 'run',
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
      if (target.includes('/backtests?status=')) return json([], 200);
      if (target.includes('/symbols?enrich=true')) return json([BTC], 200);
      if (target.includes('/config'))
        return json({ periods: [Period.OneHour], defaultPeriod: Period.OneHour }, 200);
      if (target.includes('/profiles')) return json([ALPHA], 200);
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

  function push(frame: BacktestFrame): void {
    act(() => {
      socket.onFrame?.(frame);
    });
  }

  it('creates a strategy, runs it, advances progress, and reaches completion', async () => {
    const user = userEvent.setup();
    renderPage();

    // Wait for the profile auto-select so the run has a profile.
    await screen.findByRole('button', { name: 'Alpha' });

    // Create a strategy through the real editor dialog.
    await user.click(await screen.findByRole('button', { name: /New/ }));
    await user.type(await screen.findByLabelText('Strategy name'), 'Momentum');
    await user.click(screen.getByLabelText('Entry signal state key'));
    await user.click(await screen.findByText('go_long'));
    await user.click(screen.getByRole('checkbox', { name: 'Profit target' }));
    const amount = screen.getByLabelText('Profit target amount');
    await user.clear(amount);
    await user.type(amount, '10');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // The created strategy is auto-selected; start the run.
    await waitFor(() => expect(strategies.length).toBe(1));
    await user.click(screen.getByRole('button', { name: 'Run backtest' }));
    await waitFor(() => expect(socket.onFrame).not.toBeNull());
    expect(posted).toHaveLength(1);

    // Snapshot then a mid-run delta: progress advances and the chart fills.
    push({
      kind: BacktestFrameKind.Snapshot,
      status: BacktestStatus.Running,
      progress: { elapsedDays: 0, totalDays: 2 },
      params: PARAMS,
      trades: [],
      summary: EMPTY_SUMMARY,
      events: [],
    });
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

    expect(screen.getByText('Running — 50%')).toBeInTheDocument();
    expect(screen.getByTestId('backtest-chart')).toHaveTextContent('1 candles');

    // Final frame completes the run.
    push({
      kind: BacktestFrameKind.Delta,
      status: BacktestStatus.Completed,
      progress: { elapsedDays: 2, totalDays: 2 },
      candles: [{ period: Period.OneHour, candle: candle(4_600, 108) }],
      events: [],
      trades: [],
      summary: EMPTY_SUMMARY,
      openPosition: undefined,
    });

    expect(screen.getByText('Run complete')).toBeInTheDocument();
    expect(screen.getByTestId('backtest-chart')).toHaveTextContent('2 candles');
    expect(screen.getByRole('button', { name: 'New run' })).toBeInTheDocument();
  });
});
