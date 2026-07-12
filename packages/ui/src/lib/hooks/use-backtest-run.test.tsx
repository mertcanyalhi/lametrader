// @vitest-environment jsdom
import {
  type Backtest,
  BacktestStatus,
  type BacktestStrategy,
  BacktestThresholdKind,
  Period,
  StateValueType,
} from '@lametrader/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement as h, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBacktestRun } from './use-backtest-run.js';

/**
 * Tests for the poll-based {@link useBacktestRun} hook.
 *
 * The run no longer streams (ADR-0022): the hook polls `GET /backtests/:id` on an
 * interval while the run is `Running` and stops once it reports `Completed`. Mock
 * at the `fetch` boundary — like the sibling hook tests — so the real `apiFetch`
 * and a real `QueryClient` are exercised end-to-end; a mutable poll document lets
 * a test flip the run from running to completed between polls.
 */

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
  symbolId: 'crypto:BTCUSDT',
  profileId: 'p-1',
  profileName: 'Alpha',
  period: Period.OneHour,
  start: 0,
  end: 172_800_000,
  initialCapital: 1_000,
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

/** A running poll document — the backtest plus its live `progress`, half elapsed. */
const RUNNING_DOC = {
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
  progress: { elapsedDays: 1, totalDays: 2 },
};

/** A completed poll document — same run, status flipped and progress fully elapsed. */
const COMPLETED_DOC = {
  ...RUNNING_DOC,
  status: BacktestStatus.Completed,
  progress: { elapsedDays: 2, totalDays: 2 },
};

describe('useBacktestRun', () => {
  let queryClient: QueryClient;
  let pollDoc: Record<string, unknown>;
  let fetchCalls: number;

  beforeEach(() => {
    pollDoc = RUNNING_DOC;
    fetchCalls = 0;
    const fetchSpy = vi.fn(async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify(pollDoc), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function wrapper({ children }: { children: ReactNode }): ReactNode {
    return h(QueryClientProvider, { client: queryClient }, children);
  }

  it('returns null when nothing is active', () => {
    const { result } = renderHook(() => useBacktestRun(null), { wrapper });

    expect(result.current).toBeNull();
  });

  it('returns null before the first poll response arrives', () => {
    const { result } = renderHook(() => useBacktestRun({ id: 'b-1' }), { wrapper });

    expect(result.current).toBeNull();
  });

  it('returns the status, progress, and document after the first poll response', async () => {
    const { result } = renderHook(() => useBacktestRun({ id: 'b-1' }), { wrapper });

    await waitFor(() => expect(result.current).not.toBeNull());

    expect(result.current).toEqual({
      status: BacktestStatus.Running,
      progress: { elapsedDays: 1, totalDays: 2 },
      backtest: RUNNING_DOC,
    });
  });

  it('keeps polling while running, then flips to Completed and stops once the run finishes', async () => {
    const { result } = renderHook(() => useBacktestRun({ id: 'b-1' }), { wrapper });

    await waitFor(() => expect(result.current?.status).toEqual(BacktestStatus.Running));

    // The next scheduled poll observes a completed document.
    pollDoc = COMPLETED_DOC;
    await waitFor(() => expect(result.current?.status).toEqual(BacktestStatus.Completed), {
      timeout: 3_000,
    });

    // The initial poll plus the one that saw completion — polling then stops
    // (`refetchInterval` is false once the run is no longer Running).
    expect({
      view: result.current,
      fetchCalls,
    }).toEqual({
      view: {
        status: BacktestStatus.Completed,
        progress: { elapsedDays: 2, totalDays: 2 },
        backtest: COMPLETED_DOC,
      },
      fetchCalls: 2,
    });
  });

  it('falls back to a fully-elapsed progress when a completed poll omits progress', async () => {
    const { progress: _omitted, ...noProgress } = COMPLETED_DOC;
    pollDoc = noProgress;
    const { result } = renderHook(() => useBacktestRun({ id: 'b-1' }), { wrapper });

    await waitFor(() => expect(result.current).not.toBeNull());

    expect(result.current).toEqual({
      status: BacktestStatus.Completed,
      progress: { elapsedDays: 2, totalDays: 2 },
      backtest: noProgress as unknown as Backtest,
    });
  });
});
