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
const {
  createdSeries,
  listeners,
  crosshairCallbacks,
  eventMarkerPlugins,
  createMarkersCalls,
  timeScale,
} = vi.hoisted(() => ({
  createdSeries: [] as Array<{
    setData: ReturnType<typeof vi.fn>;
    applyOptions: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  }>,
  listeners: [] as Array<(event: unknown) => void>,
  crosshairCallbacks: [] as Array<(param: { time?: number }) => void>,
  eventMarkerPlugins: [] as Array<{ setMarkers: ReturnType<typeof vi.fn> }>,
  /** Each `createSeriesMarkers(...)` call's initial markers list, in order. */
  createMarkersCalls: [] as unknown[][],
  // A single, stable time-scale so viewport calls are captured across renders
  // (a fresh object per `timeScale()` call would drop the spies before assertion).
  timeScale: {
    subscribeVisibleLogicalRangeChange: vi.fn(),
    subscribeVisibleTimeRangeChange: vi.fn(),
    setVisibleRange: vi.fn(),
    setVisibleLogicalRange: vi.fn(),
    getVisibleLogicalRange: vi.fn(() => null as { from: number; to: number } | null),
  },
}));

vi.mock('lightweight-charts', () => ({
  createChart: () => ({
    addSeries: () => {
      const series = { setData: vi.fn(), applyOptions: vi.fn(), update: vi.fn() };
      createdSeries.push(series);
      return series;
    },
    timeScale: () => timeScale,
    priceScale: () => ({ applyOptions: vi.fn() }),
    subscribeCrosshairMove: (cb: (param: { time?: number }) => void) => {
      crosshairCallbacks.push(cb);
    },
    remove: vi.fn(),
  }),
  CandlestickSeries: 'Candlestick',
  HistogramSeries: 'Histogram',
  LineSeries: 'Line',
  createSeriesMarkers: (_series: unknown, initial: unknown[]) => {
    createMarkersCalls.push(initial);
    const plugin = { setMarkers: vi.fn() };
    eventMarkerPlugins.push(plugin);
    return plugin;
  },
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
    crosshairCallbacks.length = 0;
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

  it('shows a hovered previous live bar in the legend, not the latest', () => {
    render(chartElement([bar(1000, 100, 100, 100, 100)]));
    // An earlier live bar (close 150) and a later "latest" one (close 200).
    emit(event(bar(2000, 140, 160, 130, 150)));
    emit(event(bar(3000, 150, 210, 150, 200)));
    // Hover the earlier live bar (time 2000 ms → 2 s); it isn't in the historical
    // `candles`, so only the live-bar lookup can surface its values.
    act(() => {
      for (const cb of crosshairCallbacks) cb({ time: 2 });
    });

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

/** Build a `chartElement` that also accepts `eventMarkers`. */
function chartWithMarkers(
  candles: Candle[],
  eventMarkers: ReadonlyArray<{ time: number; shape: string; color: string; position: string }>,
) {
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
          eventMarkers={eventMarkers as never}
        />
      </Theme>
    </ThemeProvider>
  );
}

describe('CandleChart event markers', () => {
  beforeEach(() => {
    createdSeries.length = 0;
    listeners.length = 0;
    crosshairCallbacks.length = 0;
    eventMarkerPlugins.length = 0;
    createMarkersCalls.length = 0;
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('attaches no marker plugin when eventMarkers is empty', () => {
    render(chartWithMarkers([bar(1000, 100, 100, 100, 100)], []));

    expect({ creates: createMarkersCalls.length, plugins: eventMarkerPlugins.length }).toEqual({
      creates: 0,
      plugins: 0,
    });
  });

  it('attaches one marker plugin via createSeriesMarkers when eventMarkers is non-empty', () => {
    const markers = [
      { time: 1, shape: 'circle', color: 'red', position: 'inBar' },
      { time: 2, shape: 'arrowUp', color: 'green', position: 'belowBar' },
    ];
    render(chartWithMarkers([bar(1000, 100, 100, 100, 100)], markers));

    expect(createMarkersCalls).toEqual([markers]);
  });

  it('calls setMarkers on the existing plugin when the eventMarkers prop changes', () => {
    const initial = [{ time: 1, shape: 'circle', color: 'red', position: 'inBar' }];
    const { rerender } = render(chartWithMarkers([bar(1000, 100, 100, 100, 100)], initial));
    const next = [{ time: 2, shape: 'square', color: 'blue', position: 'aboveBar' }];
    rerender(chartWithMarkers([bar(1000, 100, 100, 100, 100)], next));

    expect({
      creates: createMarkersCalls.length,
      setCalls: eventMarkerPlugins[0]?.setMarkers.mock.calls,
    }).toEqual({
      creates: 1,
      setCalls: [[next]],
    });
  });
});

/** A `bars`-long ascending crypto series, one candle per second starting at `time` ms. */
function series(count: number, from = 1000): Candle[] {
  return Array.from({ length: count }, (_, i) => bar(from + i * 1000, 100, 100, 100, 100));
}

/** A chart element with the replay `follow` rolling-window prop set. */
function followChart(candles: Candle[], follow: boolean) {
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
          follow={follow}
        />
      </Theme>
    </ThemeProvider>
  );
}

describe('CandleChart replay rolling window', () => {
  beforeEach(() => {
    createdSeries.length = 0;
    listeners.length = 0;
    crosshairCallbacks.length = 0;
    timeScale.setVisibleLogicalRange.mockClear();
    timeScale.getVisibleLogicalRange.mockReset();
    timeScale.getVisibleLogicalRange.mockReturnValue(null);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('frames the last-20-bars logical window when candles are set in follow mode', () => {
    render(followChart(series(25), true));

    expect(timeScale.setVisibleLogicalRange.mock.calls).toEqual([[{ from: 5, to: 24 }]]);
  });

  it('moves the window forward to the newest bars when a candle is appended', () => {
    const { rerender } = render(followChart(series(25), true));
    rerender(followChart(series(26), true));

    expect(timeScale.setVisibleLogicalRange.mock.calls).toEqual([
      [{ from: 5, to: 24 }],
      [{ from: 6, to: 25 }],
    ]);
  });

  it("re-frames at the user's widened count when the visible window is wider than the default", () => {
    timeScale.getVisibleLogicalRange.mockReturnValue({ from: 0, to: 49 });
    render(followChart(series(60), true));

    expect(timeScale.setVisibleLogicalRange.mock.calls).toEqual([[{ from: 10, to: 59 }]]);
  });

  it('does not re-frame the viewport on candle growth when follow is off', () => {
    const { rerender } = render(followChart(series(25), false));
    rerender(followChart(series(26), false));

    expect(timeScale.setVisibleLogicalRange.mock.calls).toEqual([]);
  });
});
