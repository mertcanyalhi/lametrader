// @vitest-environment jsdom
import {
  type Backtest,
  BacktestExitReason,
  BacktestStatus,
  type BacktestStrategy,
  BacktestThresholdKind,
  type Candle,
  Period,
  type RuleEventEntry,
  RuleEventType,
  StateScope,
  StateValueType,
  SymbolType,
} from '@lametrader/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement as h, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLoadedBacktest } from './use-loaded-backtest.js';

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
  totalPnl: 19,
  roiPct: 0.19,
  avgPnlPerTrade: 19,
  tradeCount: 1,
  winners: 1,
  losers: 0,
  avgRoiPct: 9.5,
  avgDaysInTrade: 0.5,
};

const TRADE = {
  entryTs: 1_000,
  exitTs: 3_600_000,
  entryPrice: 100,
  exitPrice: 110,
  quantity: 2,
  commission: 1,
  pnl: 19,
  roiPct: 9.5,
  exitReason: BacktestExitReason.ProfitTarget,
};

const BACKTEST: Backtest = {
  id: 'b-1',
  name: 'First run',
  status: BacktestStatus.Completed,
  createdAt: 1,
  updatedAt: 1,
  params: {
    symbolId: 'crypto:BTCUSDT',
    profileId: 'p-alpha',
    profileName: 'Alpha',
    period: Period.OneHour,
    start: 0,
    end: 172_800_000,
    initialCapital: 10_000,
    commission: {},
  },
  strategyId: 's-1',
  strategy: STRATEGY,
  trades: [TRADE],
  summary: SUMMARY,
};

function candle(time: number, close: number): Candle {
  return { type: SymbolType.Fx, time, open: close, high: close, low: close, close };
}

function event(ts: number): RuleEventEntry {
  return {
    type: RuleEventType.StateSet,
    ts,
    ruleId: 'r-1',
    symbolId: 'crypto:BTCUSDT',
    scope: StateScope.Symbol,
    key: 'go_long',
    value: { type: StateValueType.Bool, value: true },
  };
}

describe('useLoadedBacktest', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    const fetchSpy = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes('/candles')) {
        return json({ candles: [candle(1_000, 100)], nextCursor: null, latestTime: 1_000 });
      }
      if (target.includes('/events')) {
        // Server returns newest-first; the hook re-sorts ascending.
        return json([event(5_000), event(2_000)]);
      }
      throw new Error(`unexpected fetch: ${target}`);
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function json(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function wrapper({ children }: { children: ReactNode }): ReactNode {
    return h(QueryClientProvider, { client: queryClient }, children);
  }

  it('returns null when nothing is loaded', () => {
    const { result } = renderHook(() => useLoadedBacktest(null), { wrapper });

    expect(result.current).toEqual(null);
  });

  it('assembles the finished-run view from the persisted document, its candles, and its ascending events', async () => {
    const { result } = renderHook(() => useLoadedBacktest(BACKTEST), { wrapper });

    await waitFor(() => expect(result.current?.chartCandles.length).toBe(1));
    await waitFor(() => expect(result.current?.events.length).toBe(2));

    expect(result.current).toEqual({
      status: BacktestStatus.Completed,
      progress: { elapsedDays: 2, totalDays: 2 },
      params: BACKTEST.params,
      chartCandles: [candle(1_000, 100)],
      trades: [TRADE],
      summary: SUMMARY,
      openPosition: undefined,
      events: [event(2_000), event(5_000)],
    });
  });
});
