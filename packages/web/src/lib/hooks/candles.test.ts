// @vitest-environment jsdom
import { type Candle, type CandlePage, Period, periodMillis, SymbolType } from '@lametrader/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandleEvent } from '../stream/stream-client.types.js';
import {
  CHART_CANDLE_LIMIT,
  CHART_PAGE_BARS,
  liveCandleForPeriod,
  mergeLiveCandle,
  useCandleStream,
  usePagedCandles,
} from './candles.js';

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

  it('returns a referentially stable candles array across re-renders when the data is unchanged', async () => {
    windows.set(NOW, { candles: [candle(NOW - HOUR)], nextCursor: null });

    const { result, rerender } = renderHook(
      () => usePagedCandles({ id: ID, period: Period.OneHour }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.candles).toHaveLength(1));
    const first = result.current.candles;
    rerender();

    // Same reference — consumers key effects on it, so an unchanged render must
    // not hand back a fresh array (which would re-run setData and drop live bars).
    expect(result.current.candles).toBe(first);
  });
});

/** A controllable fake `WebSocket` for the shared stream client. */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  readonly sent: unknown[] = [];
  private readonly listeners: Record<string, Array<(event: unknown) => void>> = {};

  constructor() {
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, cb: (event: unknown) => void): void {
    const list = this.listeners[type] ?? [];
    list.push(cb);
    this.listeners[type] = list;
  }
  send(raw: string): void {
    this.sent.push(JSON.parse(raw));
  }
  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    for (const cb of this.listeners.close ?? []) cb({});
  }
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    for (const cb of this.listeners.open ?? []) cb({});
  }
  emit(frame: unknown): void {
    for (const cb of this.listeners.message ?? []) cb({ data: JSON.stringify(frame) });
  }
}

const OTHER = 'crypto:ETHUSDT';

/** A candle event frame for an id on a period. */
const candleEvent = (id: string, period: Period): CandleEvent => ({
  id,
  period,
  candle: candle(NOW),
  final: false,
});

describe('useCandleStream', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('returns null before any frame and the latest candle event once one arrives', () => {
    const { result } = renderHook(() => useCandleStream(ID));
    const before = result.current;
    const socket = FakeWebSocket.instances[0];
    const event = candleEvent(ID, Period.OneHour);
    act(() => {
      socket?.open();
      socket?.emit(event);
    });

    expect({ before, after: result.current }).toEqual({ before: null, after: event });
  });

  it('unsubscribes the old id and subscribes the new one when id changes', () => {
    const { rerender } = renderHook(({ id }) => useCandleStream(id), { initialProps: { id: ID } });
    act(() => FakeWebSocket.instances[0]?.open());
    // Changing id releases the sole subscription (closing the idle socket) and
    // opens a fresh one for the new id; open it so its replayed subscribe lands.
    act(() => rerender({ id: OTHER }));
    act(() => FakeWebSocket.instances[1]?.open());

    expect(FakeWebSocket.instances.flatMap((socket) => socket.sent)).toEqual([
      { action: 'subscribe', id: ID },
      { action: 'unsubscribe', id: ID },
      { action: 'subscribe', id: OTHER },
    ]);
  });
});

describe('liveCandleForPeriod', () => {
  it('returns the event candle when the period matches the charted period', () => {
    const event = candleEvent(ID, Period.OneHour);
    expect(liveCandleForPeriod(event, Period.OneHour)).toEqual(candle(NOW));
  });

  it('returns null when the event is for a different period than the chart', () => {
    const event = candleEvent(ID, Period.OneDay);
    expect(liveCandleForPeriod(event, Period.OneHour)).toEqual(null);
  });
});

describe('mergeLiveCandle', () => {
  /** A crypto candle with explicit OHLCV at `time`. */
  const crypto = (
    open: number,
    high: number,
    low: number,
    close: number,
    volume: number,
  ): Candle => ({
    type: SymbolType.Crypto,
    time: 1000,
    open,
    high,
    low,
    close,
    volume,
    quoteVolume: volume,
    trades: 1,
  });

  it('returns the incoming candle unchanged when there is no accumulated bar', () => {
    const incoming = crypto(100, 100, 100, 100, 5);
    expect(mergeLiveCandle(undefined, incoming)).toEqual(incoming);
  });

  it('keeps the open, widens running high/low, follows the latest close and max volume', () => {
    const existing = crypto(100, 101, 99, 100, 5);
    // A later flat tick at a higher price: high extends, low holds, close follows.
    const incoming = crypto(103, 103, 103, 103, 8);

    expect(mergeLiveCandle(existing, incoming)).toEqual({
      type: SymbolType.Crypto,
      time: 1000,
      open: 100,
      high: 103,
      low: 99,
      close: 103,
      volume: 8,
      quoteVolume: 8,
      trades: 1,
    });
  });

  it('widens the running low when a later tick prints below it', () => {
    const existing = crypto(100, 101, 99, 100, 5);
    const incoming = crypto(97, 97, 97, 97, 6);

    expect(mergeLiveCandle(existing, incoming)).toEqual({
      type: SymbolType.Crypto,
      time: 1000,
      open: 100,
      high: 101,
      low: 97,
      close: 97,
      volume: 6,
      quoteVolume: 6,
      trades: 1,
    });
  });

  it('merges an fx candle without a volume field', () => {
    const existing: Candle = {
      type: SymbolType.Fx,
      time: 1000,
      open: 1.1,
      high: 1.1,
      low: 1.1,
      close: 1.1,
    };
    const incoming: Candle = {
      type: SymbolType.Fx,
      time: 1000,
      open: 1.12,
      high: 1.12,
      low: 1.12,
      close: 1.12,
    };

    expect(mergeLiveCandle(existing, incoming)).toEqual({
      type: SymbolType.Fx,
      time: 1000,
      open: 1.1,
      high: 1.12,
      low: 1.1,
      close: 1.12,
    });
  });
});
