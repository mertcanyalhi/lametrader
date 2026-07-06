// @vitest-environment jsdom
import {
  type BacktestFrame,
  BacktestFrameKind,
  BacktestStatus,
  type Candle,
  Period,
  SymbolType,
} from '@lametrader/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement as h, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonSocketHandlers } from '../ws/json-socket.js';
import { type ActiveBacktest, useBacktestRun } from './use-backtest-run.js';

/** The frame handler the mocked socket captured, so tests can push frames. */
let onFrame: ((frame: BacktestFrame) => void) | null;
/** How many times a socket was opened / closed, to assert lifecycle. */
let closed: number;

vi.mock('../ws/json-socket.js', () => ({
  openJsonSocket: (_path: string, handlers: JsonSocketHandlers<BacktestFrame>) => {
    onFrame = handlers.onFrame;
    return {
      close: () => {
        closed += 1;
        onFrame = null;
      },
    };
  },
}));

const PARAMS = {
  symbolId: 'crypto:BTCUSDT',
  profileId: 'p-1',
  profileName: 'Alpha',
  period: Period.OneHour,
  start: 1_000,
  end: 100_000,
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

function candle(time: number, close: number): Candle {
  return { type: SymbolType.Fx, time, open: close, high: close, low: close, close };
}

function snapshot(): BacktestFrame {
  return {
    kind: BacktestFrameKind.Snapshot,
    status: BacktestStatus.Running,
    progress: { elapsedDays: 0, totalDays: 1 },
    params: PARAMS,
    trades: [],
    summary: EMPTY_SUMMARY,
    events: [],
  };
}

describe('useBacktestRun', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    onFrame = null;
    closed = 0;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function wrapper({ children }: { children: ReactNode }): ReactNode {
    return h(QueryClientProvider, { client: queryClient }, children);
  }

  function push(frame: BacktestFrame): void {
    act(() => {
      onFrame?.(frame);
    });
  }

  it('returns null before any frame arrives', () => {
    const { result } = renderHook(() => useBacktestRun({ id: 'b-1', reattach: false }), {
      wrapper,
    });

    expect(result.current).toBeNull();
  });

  it('returns null when nothing is active', () => {
    const { result } = renderHook(() => useBacktestRun(null), { wrapper });

    expect(result.current).toBeNull();
  });

  it('seeds the view from the snapshot frame', () => {
    const { result } = renderHook(() => useBacktestRun({ id: 'b-1', reattach: false }), {
      wrapper,
    });

    push(snapshot());

    expect(result.current).toEqual({
      status: BacktestStatus.Running,
      progress: { elapsedDays: 0, totalDays: 1 },
      params: PARAMS,
      chartCandles: [],
      trades: [],
      summary: EMPTY_SUMMARY,
      openPosition: undefined,
      events: [],
    });
  });

  it('accumulates run-period candles from delta frames and projects them onto the chart', () => {
    const { result } = renderHook(() => useBacktestRun({ id: 'b-1', reattach: false }), {
      wrapper,
    });

    push(snapshot());
    push({
      kind: BacktestFrameKind.Delta,
      status: BacktestStatus.Running,
      progress: { elapsedDays: 0.5, totalDays: 1 },
      candles: [
        { period: Period.OneHour, candle: candle(1_000, 100) },
        { period: Period.OneDay, candle: candle(1_000, 999) },
      ],
      events: [],
      trades: [],
      summary: EMPTY_SUMMARY,
      openPosition: undefined,
    });

    expect(result.current?.chartCandles).toEqual([candle(1_000, 100)]);
    expect(result.current?.progress).toEqual({ elapsedDays: 0.5, totalDays: 1 });
  });

  it('reports the Completed status on the final delta frame', () => {
    const { result } = renderHook(() => useBacktestRun({ id: 'b-1', reattach: false }), {
      wrapper,
    });

    push(snapshot());
    push({
      kind: BacktestFrameKind.Delta,
      status: BacktestStatus.Completed,
      progress: { elapsedDays: 1, totalDays: 1 },
      candles: [],
      events: [],
      trades: [],
      summary: EMPTY_SUMMARY,
      openPosition: undefined,
    });

    expect(result.current?.status).toEqual(BacktestStatus.Completed);
  });

  it('closes the socket when the active run clears', () => {
    const initialProps: { active: ActiveBacktest | null } = {
      active: { id: 'b-1', reattach: false },
    };
    const { rerender } = renderHook(
      ({ active }: { active: ActiveBacktest | null }) => useBacktestRun(active),
      { wrapper, initialProps },
    );

    rerender({ active: null });

    expect(closed).toEqual(1);
  });

  it('catches a reattached run up over REST, merging stored candles under the frame candles', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candles: [candle(1_000, 100), candle(4_600, 105)],
            nextCursor: null,
            latestTime: 4_600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { result } = renderHook(() => useBacktestRun({ id: 'b-1', reattach: true }), { wrapper });

    push({ ...snapshot(), progress: { elapsedDays: 0.5, totalDays: 1 } } as BacktestFrame);

    await waitFor(() => {
      expect(result.current?.chartCandles).toEqual([candle(1_000, 100), candle(4_600, 105)]);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
