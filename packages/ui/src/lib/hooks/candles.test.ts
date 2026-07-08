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
  mergeCandlesByTime,
  useBacktestSetupCandles,
  useCandleStream,
  useLatestCandle,
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
  /** Window contents keyed by the window's exclusive upper bound (`to`). */
  let windows: Map<number, { candles: Candle[]; nextCursor: number | null }>;

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    windows = new Map();
    fetchSpy = vi.fn(async (url: string) => {
      const to = Number(new URL(String(url), 'http://x').searchParams.get('to'));
      const window = windows.get(to) ?? { candles: [], nextCursor: null };
      // latestTime is the latest stored bar across ALL windows, independent of the
      // requested window — exactly what the server reports (issue #70).
      const times = [...windows.values()].flatMap((w) => w.candles.map((c) => c.time));
      const page: CandlePage = {
        ...window,
        latestTime: times.length > 0 ? Math.max(...times) : null,
      };
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

  it('does not issue a second older-window request while the first is still in flight', async () => {
    windows.set(NOW, { candles: [candle(NOW - HOUR)], nextCursor: null });
    windows.set(NOW - SPAN, { candles: [candle(NOW - SPAN - HOUR)], nextCursor: null });

    // Hang the older-window fetch so it stays in flight, and count how many times
    // that window is requested — a runaway re-entrant loadOlder would stack more.
    const olderRequests: string[] = [];
    let releaseOlder: () => void = () => {};
    fetchSpy.mockImplementation(async (url: string) => {
      const to = Number(new URL(String(url), 'http://x').searchParams.get('to'));
      if (to === NOW - SPAN) {
        olderRequests.push(String(url));
        await new Promise<void>((resolve) => {
          releaseOlder = resolve;
        });
      }
      const window = windows.get(to) ?? { candles: [], nextCursor: null };
      const times = [...windows.values()].flatMap((w) => w.candles.map((c) => c.time));
      const page: CandlePage = {
        ...window,
        latestTime: times.length > 0 ? Math.max(...times) : null,
      };
      return new Response(JSON.stringify(page), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const { result, rerender } = renderHook(
      () => usePagedCandles({ id: ID, period: Period.OneHour }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.candles).toHaveLength(1));
    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.isFetchingOlder).toBe(true));
    // A viewport effect re-running (re-render) then re-invoking loadOlder must not
    // stack a second request while the first older fetch is still in flight.
    rerender();
    act(() => result.current.loadOlder());
    act(() => result.current.loadOlder());

    expect({
      olderRequests: olderRequests.length,
      isFetchingOlder: result.current.isFetchingOlder,
    }).toEqual({ olderRequests: 1, isFetchingOlder: true });
    releaseOlder();
  });

  it('does not fetch another window once history is exhausted', async () => {
    windows.set(NOW, { candles: [candle(NOW - HOUR)], nextCursor: null });
    windows.set(NOW - SPAN, { candles: [], nextCursor: null });

    const { result } = renderHook(() => usePagedCandles({ id: ID, period: Period.OneHour }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.candles).toHaveLength(1));
    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.hasMore).toBe(false));
    const callsAtStop = fetchSpy.mock.calls.length;
    // Repeated triggers past the end of history (as scroll-back / range effects
    // would fire) must be inert — no further requests.
    act(() => result.current.loadOlder());
    act(() => result.current.loadOlder());

    expect({ hasMore: result.current.hasMore, calls: fetchSpy.mock.calls.length }).toEqual({
      hasMore: false,
      calls: callsAtStop,
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

  it('catches up to the current time when reopened, filling bars the frozen paged window misses', async () => {
    windows.set(NOW, { candles: [candle(NOW - HOUR)], nextCursor: null });
    const first = renderHook(() => usePagedCandles({ id: ID, period: Period.OneHour }), {
      wrapper,
    });
    await waitFor(() => expect(first.result.current.candles).toEqual([candle(NOW - HOUR)]));
    first.unmount();

    // Reopen the chart later (navigate back). The catch-up window now covers newer
    // bars; the paged (infinite) query stays frozen at its first-open `to`, so the
    // catch-up is what fills the gap.
    const LATER = NOW + 3 * HOUR;
    vi.mocked(Date.now).mockReturnValue(LATER);
    windows.set(LATER, {
      candles: [candle(NOW - HOUR), candle(NOW), candle(NOW + HOUR), candle(NOW + 2 * HOUR)],
      nextCursor: null,
    });
    const second = renderHook(() => usePagedCandles({ id: ID, period: Period.OneHour }), {
      wrapper,
    });

    await waitFor(() => expect(second.result.current.candles).toHaveLength(4));
    expect(second.result.current.candles).toEqual([
      candle(NOW - HOUR),
      candle(NOW),
      candle(NOW + HOUR),
      candle(NOW + 2 * HOUR),
    ]);
  });

  it('re-anchors to the latest stored bar and refetches when the now window is empty but older history exists', async () => {
    // History sits far before the now-anchored window, so the first fetch is empty.
    const STALE = NOW - 10 * SPAN;
    windows.set(STALE + 1, {
      candles: [candle(STALE - HOUR), candle(STALE)],
      nextCursor: null,
    });

    const { result } = renderHook(() => usePagedCandles({ id: ID, period: Period.OneHour }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.candles).toHaveLength(2));

    expect({
      candles: result.current.candles,
      reanchorUrl: fetchSpy.mock.calls
        .map((call) => String(call[0]))
        .find((url) => url.includes(`to=${STALE + 1}`)),
    }).toEqual({
      candles: [candle(STALE - HOUR), candle(STALE)],
      reanchorUrl: `/api/symbols/${ID}/candles?period=1h&from=${STALE + 1 - SPAN}&to=${STALE + 1}&limit=${CHART_CANDLE_LIMIT}`,
    });
  });

  it('does not re-anchor and keeps an empty result when nothing is stored for the symbol+period', async () => {
    // No windows set → every window empty and latestTime null (the empty-state signal).
    const { result } = renderHook(() => usePagedCandles({ id: ID, period: Period.OneHour }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect({
      candles: result.current.candles,
      reanchored: fetchSpy.mock.calls.some((call) => !String(call[0]).includes(`to=${NOW}`)),
    }).toEqual({ candles: [], reanchored: false });
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

describe('useLatestCandle', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('keeps the charted period bar when a frame for another period arrives after it', () => {
    const hourly = { id: ID, period: Period.OneHour, candle: candle(NOW), final: false };
    const daily = { id: ID, period: Period.OneDay, candle: candle(NOW + 1_000), final: false };
    const { result } = renderHook(() => useLatestCandle(ID, Period.OneHour));
    const socket = FakeWebSocket.instances[0];

    act(() => {
      socket?.open();
      socket?.emit(hourly);
      socket?.emit(daily);
    });

    expect(result.current).toEqual(hourly.candle);
  });

  it('returns null when only another period has streamed', () => {
    const daily = { id: ID, period: Period.OneDay, candle: candle(NOW), final: false };
    const { result } = renderHook(() => useLatestCandle(ID, Period.OneHour));
    const socket = FakeWebSocket.instances[0];

    act(() => {
      socket?.open();
      socket?.emit(daily);
    });

    expect(result.current).toEqual(null);
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

describe('mergeCandlesByTime', () => {
  it('returns the paged series unchanged when there is no catch-up data', () => {
    const paged = [candle(NOW - HOUR), candle(NOW)];
    expect(mergeCandlesByTime(paged, [])).toEqual([candle(NOW - HOUR), candle(NOW)]);
  });

  it('appends newer catch-up bars and keeps the series ascending by time', () => {
    const paged = [candle(NOW - HOUR), candle(NOW)];
    const latest = [candle(NOW + HOUR), candle(NOW + 2 * HOUR)];

    expect(mergeCandlesByTime(paged, latest)).toEqual([
      candle(NOW - HOUR),
      candle(NOW),
      candle(NOW + HOUR),
      candle(NOW + 2 * HOUR),
    ]);
  });

  it('dedupes overlapping times with the catch-up bar winning (fresher reading)', () => {
    const stale: Candle = { ...candle(NOW), close: 1 };
    const fresh: Candle = { ...candle(NOW), close: 2 };

    expect(mergeCandlesByTime([candle(NOW - HOUR), stale], [fresh])).toEqual([
      candle(NOW - HOUR),
      fresh,
    ]);
  });
});

/** A 15m step — the smaller period folded up into the 1h forming bar. */
const Q = periodMillis(Period.FifteenMinutes);
/** "now" 40 min into the `NOW` 1h bucket, so the bucket start floors back to `NOW`. */
const MID = NOW + 40 * 60_000;

describe('useBacktestSetupCandles', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let queryClient: QueryClient;
  /** Candles the fetch mock returns for the smaller (15m) period's seed window. */
  let seed15m: Candle[];
  /** Candles the fetch mock returns for the selected (1h) period's own windows. */
  let native1h: Candle[];

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(MID);
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    seed15m = [];
    native1h = [];
    fetchSpy = vi.fn(async (url: string) => {
      const period = new URL(String(url), 'http://x').searchParams.get('period');
      const candles = period === '15m' ? seed15m : native1h;
      const times = candles.map((c) => c.time);
      const page: CandlePage = {
        candles,
        nextCursor: null,
        latestTime: times.length > 0 ? Math.max(...times) : null,
      };
      return new Response(JSON.stringify(page), {
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
    return createElement(QueryClientProvider, { client: queryClient }, children);
  }

  it('passes the period through unchanged and never seeds when it has its own candles', async () => {
    native1h = [candle(NOW - HOUR), candle(NOW)];

    const { result } = renderHook(
      () =>
        useBacktestSetupCandles({
          id: ID,
          period: Period.OneHour,
          smallerPeriod: Period.FifteenMinutes,
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.candles).toHaveLength(2));

    expect({
      candles: result.current.candles,
      seededSmaller: fetchSpy.mock.calls.some((call) => String(call[0]).includes('period=15m')),
    }).toEqual({ candles: [candle(NOW - HOUR), candle(NOW)], seededSmaller: false });
  });

  it('synthesizes a single forming bar from the smaller period when the period has no native candles', async () => {
    seed15m = [candle(NOW), candle(NOW + Q)];

    const { result } = renderHook(
      () =>
        useBacktestSetupCandles({
          id: ID,
          period: Period.OneHour,
          smallerPeriod: Period.FifteenMinutes,
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.candles).toHaveLength(1));

    expect(result.current.candles).toEqual([
      {
        type: SymbolType.Crypto,
        time: NOW,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 20,
        quoteVolume: 30,
        trades: 6,
      },
    ]);
  });

  it('folds a live smaller-period frame into the forming bar, updating its high/low/close', async () => {
    seed15m = [candle(NOW)];

    const { result } = renderHook(
      () =>
        useBacktestSetupCandles({
          id: ID,
          period: Period.OneHour,
          smallerPeriod: Period.FifteenMinutes,
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.candles).toHaveLength(1));
    // A live 15m frame later in the same 1h bucket, extending the range and close.
    const frame: CandleEvent = {
      id: ID,
      period: Period.FifteenMinutes,
      candle: { ...candle(NOW + Q), high: 9, low: 0.1, close: 7 },
      final: false,
    };
    const socket = FakeWebSocket.instances[0];
    act(() => {
      socket?.open();
      socket?.emit(frame);
    });
    await waitFor(() => expect(result.current.candles[0]?.close).toBe(7));

    expect(result.current.candles).toEqual([
      {
        type: SymbolType.Crypto,
        time: NOW,
        open: 1,
        high: 9,
        low: 0.1,
        close: 7,
        volume: 20,
        quoteVolume: 30,
        trades: 6,
      },
    ]);
  });
});
