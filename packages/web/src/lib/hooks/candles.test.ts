// @vitest-environment jsdom
import { type Candle, type CandlePage, Period, periodMillis, SymbolType } from '@lametrader/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHART_CANDLE_LIMIT, CHART_PAGE_BARS, usePagedCandles } from './candles.js';

/** A fixed "now" so the windowed query params are deterministic. */
const NOW = Date.UTC(2024, 5, 1);
const ID = 'crypto:BTCUSDT';
const HOUR = periodMillis(Period.OneHour);
/** The width of one fetch window for the 1h period. */
const SPAN = CHART_PAGE_BARS * HOUR;

/** Build a crypto candle at `time`. */
const candle = (time: number): Candle => ({
  type: SymbolType.Crypto,
  time,
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
  volume: 10,
  quoteVolume: 15,
  trades: 3,
});

describe('usePagedCandles', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let queryClient: QueryClient;
  /** Pages keyed by the window's exclusive upper bound (`to`). */
  let windows: Map<number, CandlePage>;

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    windows = new Map();
    fetchSpy = vi.fn(async (url: string) => {
      const to = Number(new URL(String(url), 'http://x').searchParams.get('to'));
      const page = windows.get(to) ?? { candles: [], nextCursor: null };
      return new Response(JSON.stringify(page), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function wrapper({ children }: { children: ReactNode }): ReactNode {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  }

  it('loads the initial window anchored at now and exposes its candles ascending', async () => {
    windows.set(NOW, { candles: [candle(NOW - 2 * HOUR), candle(NOW - HOUR)], nextCursor: null });

    const { result } = renderHook(() => usePagedCandles({ id: ID, period: Period.OneHour }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.candles).toHaveLength(2));

    expect({
      url: String(fetchSpy.mock.calls[0]?.[0]),
      candles: result.current.candles,
      hasMore: result.current.hasMore,
    }).toEqual({
      url: `/api/symbols/${ID}/candles?period=1h&from=${NOW - SPAN}&to=${NOW}&limit=${CHART_CANDLE_LIMIT}`,
      candles: [candle(NOW - 2 * HOUR), candle(NOW - HOUR)],
      hasMore: true,
    });
  });

  it('prepends an older window when loadOlder is called', async () => {
    windows.set(NOW, { candles: [candle(NOW - 2 * HOUR), candle(NOW - HOUR)], nextCursor: null });
    windows.set(NOW - SPAN, {
      candles: [candle(NOW - SPAN - 2 * HOUR), candle(NOW - SPAN - HOUR)],
      nextCursor: null,
    });

    const { result } = renderHook(() => usePagedCandles({ id: ID, period: Period.OneHour }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.candles).toHaveLength(2));
    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.candles).toHaveLength(4));

    expect(result.current.candles).toEqual([
      candle(NOW - SPAN - 2 * HOUR),
      candle(NOW - SPAN - HOUR),
      candle(NOW - 2 * HOUR),
      candle(NOW - HOUR),
    ]);
  });

  it('stops paging when an older window is empty and issues no further request', async () => {
    windows.set(NOW, { candles: [candle(NOW - HOUR)], nextCursor: null });
    windows.set(NOW - SPAN, { candles: [], nextCursor: null });

    const { result } = renderHook(() => usePagedCandles({ id: ID, period: Period.OneHour }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.candles).toHaveLength(1));
    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.hasMore).toBe(false));
    const callsAfterStop = fetchSpy.mock.calls.length;
    act(() => result.current.loadOlder());

    expect({ hasMore: result.current.hasMore, calls: fetchSpy.mock.calls.length }).toEqual({
      hasMore: false,
      calls: callsAfterStop,
    });
  });

  it('reloads a fresh series when the period changes', async () => {
    const DAY = periodMillis(Period.OneDay);
    windows.set(NOW, { candles: [candle(NOW - HOUR)], nextCursor: null });
    windows.set(NOW - CHART_PAGE_BARS * DAY, { candles: [], nextCursor: null });

    const { result, rerender } = renderHook(({ period }) => usePagedCandles({ id: ID, period }), {
      wrapper,
      initialProps: { period: Period.OneHour },
    });
    await waitFor(() => expect(result.current.candles).toEqual([candle(NOW - HOUR)]));

    // The 1d series draws from a different window; it must replace, not append to, the 1h one.
    windows.clear();
    windows.set(NOW, { candles: [candle(NOW - DAY)], nextCursor: null });
    rerender({ period: Period.OneDay });
    await waitFor(() => expect(result.current.candles).toEqual([candle(NOW - DAY)]));

    expect(result.current.candles).toEqual([candle(NOW - DAY)]);
  });
});
