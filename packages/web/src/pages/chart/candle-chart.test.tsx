// @vitest-environment jsdom
import { type Candle, type EnrichedSymbol, Period, SymbolType } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../lib/theme-context.js';
import { CandleChart } from './candle-chart.js';

/**
 * `lightweight-charts` is mocked so each series records its `update` calls —
 * the chart's forming-bar mutator. The canvas isn't exercised (jsdom has no
 * rendering); we assert the data the chart pushes, not pixels.
 */
const { createdSeries } = vi.hoisted(() => ({
  createdSeries: [] as Array<{
    setData: ReturnType<typeof vi.fn>;
    applyOptions: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  }>,
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

/** The candlestick point the chart maps a candle to (time in seconds). */
const point = (candle: Candle) => ({
  time: candle.time / 1000,
  open: candle.open,
  high: candle.high,
  low: candle.low,
  close: candle.close,
});

/** Render the chart with a stable candles array so the data effect runs once. */
function chartElement(candles: Candle[], liveCandle: Candle | null) {
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
          liveCandle={liveCandle}
        />
      </Theme>
    </ThemeProvider>
  );
}

function renderChart(candles: Candle[], liveCandle: Candle | null) {
  return render(chartElement(candles, liveCandle));
}

describe('CandleChart live ticks', () => {
  beforeEach(() => {
    createdSeries.length = 0;
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('updates the last bar in place when a live candle matches its time', () => {
    const candles = [bar(1000, 100, 100, 100, 100)];
    const live = bar(1000, 100, 120, 100, 110);
    const { rerender } = renderChart(candles, null);
    rerender(chartElement(candles, live));

    expect(createdSeries[0]?.update.mock.calls).toEqual([[point(live)]]);
  });

  it('appends a new bar when a live candle has a newer time than the last', () => {
    const candles = [bar(1000, 100, 100, 100, 100)];
    const live = bar(2000, 110, 130, 105, 125);
    const { rerender } = renderChart(candles, null);
    rerender(chartElement(candles, live));

    expect(createdSeries[0]?.update.mock.calls).toEqual([[point(live)]]);
  });

  it('shows the live bar close in the legend header once a tick arrives', () => {
    const candles = [bar(1000, 100, 100, 100, 100)];
    const live = bar(1000, 100, 160, 90, 150);
    const { rerender } = renderChart(candles, null);
    rerender(chartElement(candles, live));

    expect(screen.getByText('150.00')).toBeInTheDocument();
  });

  it('re-applies every accumulated live bar after the data series is re-seeded', () => {
    const candles = [bar(1000, 100, 100, 100, 100)];
    const live2 = bar(2000, 100, 120, 100, 110);
    const live3 = bar(3000, 110, 130, 105, 125);
    const { rerender } = renderChart(candles, null);
    rerender(chartElement(candles, live2));
    rerender(chartElement(candles, live3));
    // A fresh candles array reference (theme / data refresh) re-seeds the series
    // via setData; both earlier live bars must be re-applied, not dropped.
    rerender(chartElement([bar(1000, 100, 100, 100, 100)], live3));

    expect(createdSeries[0]?.update.mock.calls).toEqual([
      [point(live2)],
      [point(live3)],
      [point(live2)],
      [point(live3)],
    ]);
  });
});
