// @vitest-environment jsdom
import {
  type Candle,
  type CandlePage,
  type EnrichedSymbol,
  Period,
  periodMillis,
  SymbolType,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandleEvent } from '../../lib/stream/stream-client.types.js';
import { ThemeProvider } from '../../lib/theme-context.js';
import { IdleBacktestChart } from './idle-backtest-chart.js';

/**
 * `lightweight-charts` is mocked so each series records `setData` — the chart's
 * data path. The shared stream client is mocked so the test captures the candle
 * listener and emits frames directly (jsdom has no socket).
 */
const { createdSeries, listeners } = vi.hoisted(() => ({
  createdSeries: [] as Array<{
    setData: ReturnType<typeof vi.fn>;
    applyOptions: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  }>,
  listeners: [] as Array<(event: unknown) => void>,
}));

vi.mock('lightweight-charts', () => ({
  createChart: () => ({
    addSeries: () => {
      const s = { setData: vi.fn(), applyOptions: vi.fn(), update: vi.fn() };
      createdSeries.push(s);
      return s;
    },
    timeScale: () => ({
      subscribeVisibleLogicalRangeChange: vi.fn(),
      subscribeVisibleTimeRangeChange: vi.fn(),
      setVisibleRange: vi.fn(),
      setVisibleLogicalRange: vi.fn(),
      getVisibleLogicalRange: vi.fn(() => null),
    }),
    priceScale: () => ({ applyOptions: vi.fn() }),
    subscribeCrosshairMove: vi.fn(),
    remove: vi.fn(),
  }),
  CandlestickSeries: 'Candlestick',
  HistogramSeries: 'Histogram',
  LineSeries: 'Line',
  createSeriesMarkers: () => ({ setMarkers: vi.fn() }),
}));

vi.mock('../../lib/stream/stream-client.js', () => ({
  streamClient: {
    subscribe: (_kind: unknown, _key: unknown, listener: (event: unknown) => void) => {
      listeners.push(listener);
      return () => {};
    },
    onReconnect: () => () => {},
  },
}));

const ID = 'crypto:BTCUSDT';
const SYMBOL: EnrichedSymbol = {
  id: ID,
  type: SymbolType.Crypto,
  description: 'BTC / USDT',
  exchange: 'Binance',
  currency: 'USDT',
  periods: [Period.FifteenMinutes, Period.OneHour],
  quote: null,
};

const HOUR = periodMillis(Period.OneHour);
const Q = periodMillis(Period.FifteenMinutes);
/** A 1h boundary. */
const NOW = Date.UTC(2024, 5, 1, 12, 0, 0);
/** "now" 40 min into the `NOW` bucket, so the 1h bucket start floors back to `NOW`. */
const MID = NOW + 40 * 60_000;

/** A crypto candle at `time` with fixed OHLCV. */
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

/** The candlestick point the chart maps a candle to (time in seconds). */
const point = (c: Candle) => ({
  time: c.time / 1000,
  open: c.open,
  high: c.high,
  low: c.low,
  close: c.close,
});

describe('IdleBacktestChart', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let queryClient: QueryClient;
  let seed15m: Candle[];
  let native1h: Candle[];

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(MID);
    createdSeries.length = 0;
    listeners.length = 0;
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

  function renderIdle(): void {
    render(
      <QueryClientProvider client={queryClient}>
        <Theme>
          <ThemeProvider>
            <IdleBacktestChart
              symbol={SYMBOL}
              period={Period.OneHour}
              smallerPeriod={Period.FifteenMinutes}
            />
          </ThemeProvider>
        </Theme>
      </QueryClientProvider>,
    );
  }

  it('renders the synthesized forming bar into the candle series when the period has no native candles', async () => {
    seed15m = [candle(NOW)];

    renderIdle();

    // The 1h period holds no candles, so the series is fed one forming bar timed to
    // the current 1h bucket start, aggregated from the seeded 15m candle.
    await waitFor(() =>
      expect(createdSeries[0]?.setData.mock.calls.at(-1)).toEqual([[point(candle(NOW))]]),
    );
  });

  it('folds a live smaller-period frame into the forming bar fed to the series', async () => {
    seed15m = [candle(NOW)];
    renderIdle();
    await waitFor(() =>
      expect(createdSeries[0]?.setData.mock.calls.at(-1)).toEqual([[point(candle(NOW))]]),
    );
    // A live 15m frame later in the same bucket extends the range and moves the close.
    const frame: CandleEvent = {
      id: ID,
      period: Period.FifteenMinutes,
      candle: { ...candle(NOW + Q), high: 9, low: 0.1, close: 7 },
      final: false,
    };
    act(() => {
      for (const listener of listeners) listener(frame);
    });

    await waitFor(() =>
      expect(createdSeries[0]?.setData.mock.calls.at(-1)).toEqual([
        [{ time: NOW / 1000, open: 1, high: 9, low: 0.1, close: 7 }],
      ]),
    );
  });

  it('feeds the native candles through unchanged and never seeds when the period has its own data', async () => {
    native1h = [candle(NOW - HOUR), candle(NOW)];

    renderIdle();

    await waitFor(() =>
      expect(createdSeries[0]?.setData.mock.calls.at(-1)).toEqual([
        [point(candle(NOW - HOUR)), point(candle(NOW))],
      ]),
    );
    expect(fetchSpy.mock.calls.some((call) => String(call[0]).includes('period=15m'))).toBe(false);
  });
});
