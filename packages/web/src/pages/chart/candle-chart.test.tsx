// @vitest-environment jsdom
import { type Candle, type EnrichedSymbol, Period, SymbolType } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandleEvent } from '../../lib/stream/stream-client.types.js';
import { ThemeProvider } from '../../lib/theme-context.js';
import { CandleChart } from './candle-chart.js';

/**
 * `lightweight-charts` is mocked so each series records its `update` calls — the
 * chart's forming-bar mutator. The shared stream client is mocked so the test
 * captures the candle listener and emits frames directly (jsdom has no socket).
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
      const series = { setData: vi.fn(), applyOptions: vi.fn(), update: vi.fn() };
      createdSeries.push(series);
      return series;
    },
    timeScale: () => ({
      subscribeVisibleLogicalRangeChange: vi.fn(),
      subscribeVisibleTimeRangeChange: vi.fn(),
      setVisibleRange: vi.fn(),
    }),
    priceScale: () => ({ applyOptions: vi.fn() }),
    subscribeCrosshairMove: vi.fn(),
    remove: vi.fn(),
  }),
  CandlestickSeries: 'Candlestick',
  HistogramSeries: 'Histogram',
}));

vi.mock('../../lib/stream/stream-client.js', () => ({
  streamClient: {
    subscribe: (_kind: unknown, _id: unknown, listener: (event: unknown) => void) => {
      listeners.push(listener);
      return () => {};
    },
    onReconnect: () => () => {},
  },
}));

const SYMBOL: EnrichedSymbol = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'BTC / USDT',
  exchange: 'Binance',
  currency: 'USDT',
  periods: [Period.OneHour],
  quote: null,
};

/** Build a crypto candle with explicit OHLC at `time`. */
const bar = (time: number, open: number, high: number, low: number, close: number): Candle => ({
  type: SymbolType.Crypto,
  time,
  open,
  high,
  low,
  close,
  volume: 10,
  quoteVolume: 10,
  trades: 1,
});

/** Wrap a candle in a stream event for the chart's period (or another). */
const event = (candle: Candle, period: Period = Period.OneHour): CandleEvent => ({
  id: SYMBOL.id,
  period,
  candle,
  final: false,
});

/** The candlestick point the chart maps a candle to (time in seconds). */
const point = (candle: Candle) => ({
  time: candle.time / 1000,
  open: candle.open,
  high: candle.high,
  low: candle.low,
  close: candle.close,
});

/** Deliver a candle event to every captured stream listener. */
function emit(candleEvent: CandleEvent): void {
  act(() => {
    for (const listener of listeners) listener(candleEvent);
  });
}

function chartElement(candles: Candle[]) {
  return (
    <ThemeProvider>
      <Theme>
        <CandleChart
          candles={candles}
          symbol={SYMBOL}
          period={Period.OneHour}
          range={null}
          loadOlder={() => {}}
          hasMore={false}
        />
      </Theme>
    </ThemeProvider>
  );
}

describe('CandleChart live ticks', () => {
  beforeEach(() => {
    createdSeries.length = 0;
    listeners.length = 0;
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('applies a live event to the series via update', () => {
    render(chartElement([bar(1000, 100, 100, 100, 100)]));
    const live = bar(1000, 100, 120, 100, 110);
    emit(event(live));

    expect(createdSeries[0]?.update.mock.calls).toEqual([[point(live)]]);
  });

  it('applies both a just-closed bar and the new forming bar from one poll', () => {
    render(chartElement([bar(1000, 100, 100, 100, 100)]));
    // One poll crosses the interval boundary: the closed bar's final values and
    // the next forming bar arrive as two frames — both must land, not just the last.
    const closedFinal = bar(1000, 100, 130, 95, 128);
    const newForming = bar(2000, 128, 128, 128, 128);
    emit(event(closedFinal));
    emit(event(newForming));

    expect(createdSeries[0]?.update.mock.calls).toEqual([
      [point(closedFinal)],
      [point(newForming)],
    ]);
  });

  it('ignores a live event for a different period than the chart', () => {
    render(chartElement([bar(1000, 100, 100, 100, 100)]));
    emit(event(bar(1000, 100, 120, 100, 110), Period.OneDay));

    expect(createdSeries[0]?.update.mock.calls).toEqual([]);
  });

  it('shows the live bar close in the legend header once a tick arrives', () => {
    render(chartElement([bar(1000, 100, 100, 100, 100)]));
    emit(event(bar(1000, 100, 160, 90, 150)));

    expect(screen.getByText('150.00')).toBeInTheDocument();
  });

  it('re-applies every accumulated live bar after the data series is re-seeded', () => {
    const candles = [bar(1000, 100, 100, 100, 100)];
    const { rerender } = render(chartElement(candles));
    const live2 = bar(2000, 100, 120, 100, 110);
    const live3 = bar(3000, 110, 130, 105, 125);
    emit(event(live2));
    emit(event(live3));
    // A fresh candles array reference (theme / data refresh) re-seeds via setData;
    // both accumulated live bars must be re-applied, not dropped.
    rerender(chartElement([bar(1000, 100, 100, 100, 100)]));

    expect(createdSeries[0]?.update.mock.calls).toEqual([
      [point(live2)],
      [point(live3)],
      [point(live2)],
      [point(live3)],
    ]);
  });
});
