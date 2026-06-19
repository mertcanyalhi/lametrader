// @vitest-environment jsdom
import {
  type Candle,
  type EnrichedSymbol,
  FieldType,
  type IndicatorComputeResult,
  type IndicatorDefinition,
  Pane,
  Period,
  PriceSource,
  RenderKind,
  SymbolType,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../lib/theme-context.js';
import { CandleChart, type IndicatorOverlay } from './candle-chart.js';

/**
 * The mock records every series created with its `(definition, options, paneIndex)`,
 * every series removed, and every `setMarkers` call so the assertions can pin
 * down exactly what the canvas mirrored from the `overlays[]` prop.
 */
const { createdSeries, removedSeries, markerCalls } = vi.hoisted(() => ({
  createdSeries: [] as Array<{
    definition: unknown;
    options: unknown;
    paneIndex: number | undefined;
    api: {
      setData: ReturnType<typeof vi.fn>;
      applyOptions: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  }>,
  removedSeries: [] as unknown[],
  markerCalls: [] as Array<{ markers: unknown }>,
}));

vi.mock('lightweight-charts', () => ({
  createChart: () => ({
    addSeries: (definition: unknown, options: unknown, paneIndex?: number) => {
      const api = { setData: vi.fn(), applyOptions: vi.fn(), update: vi.fn() };
      createdSeries.push({ definition, options, paneIndex, api });
      return api;
    },
    removeSeries: (series: unknown) => {
      removedSeries.push(series);
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
  createSeriesMarkers: (_series: unknown, markers: unknown) => {
    markerCalls.push({ markers });
    return {
      setMarkers: (next: unknown) => {
        markerCalls.push({ markers: next });
      },
    };
  },
}));

vi.mock('../../lib/stream/stream-client.js', () => ({
  streamClient: {
    subscribe: () => () => {},
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

const CANDLE: Candle = {
  type: SymbolType.Crypto,
  time: 1000,
  open: 100,
  high: 100,
  low: 100,
  close: 100,
  volume: 10,
  quoteVolume: 10,
  trades: 1,
};

const SMA_DEFINITION: IndicatorDefinition = {
  key: 'sma',
  name: 'Simple Moving Average',
  description: '',
  version: 1,
  appliesTo: [SymbolType.Crypto],
  inputs: [
    {
      type: FieldType.Number,
      key: 'length',
      label: 'Length',
      default: 14,
    },
    { type: FieldType.Source, key: 'source', label: 'Source', default: PriceSource.Close },
  ],
  state: [
    {
      type: FieldType.Number,
      key: 'value',
      label: 'SMA',
      render: RenderKind.Line,
      pane: Pane.Overlay,
    },
  ],
};

/** A definition with one state field that asks for its own sub-pane. */
const RSI_DEFINITION: IndicatorDefinition = {
  key: 'rsi',
  name: 'Relative Strength Index',
  description: '',
  version: 1,
  appliesTo: [SymbolType.Crypto],
  inputs: [{ type: FieldType.Number, key: 'length', label: 'Length', default: 14 }],
  state: [
    {
      type: FieldType.Number,
      key: 'value',
      label: 'RSI',
      render: RenderKind.Line,
      pane: Pane.Separate,
    },
  ],
};

/** A definition that emits an enum signal (`buy` / `sell`) drawn as markers. */
const SIGNAL_DEFINITION: IndicatorDefinition = {
  key: 'signal',
  name: 'Signal',
  description: '',
  version: 1,
  appliesTo: [SymbolType.Crypto],
  inputs: [],
  state: [
    {
      type: FieldType.Enum,
      key: 'signal',
      label: 'Signal',
      options: [
        { value: 'buy', label: 'Buy' },
        { value: 'sell', label: 'Sell' },
      ],
      render: RenderKind.Markers,
      pane: Pane.Overlay,
    },
  ],
};

/** An SMA overlay with a one-bar warm-up and two valued bars. */
const SMA_OVERLAY: IndicatorOverlay = {
  instanceId: 'inst-sma',
  definition: SMA_DEFINITION,
  result: {
    indicatorKey: 'sma',
    version: 1,
    period: Period.OneHour,
    state: [
      { time: 1000, value: null },
      { time: 2000, value: 105.5 },
      { time: 3000, value: 106 },
    ],
  },
  visible: true,
  color: '#3aa3ff',
};

const RSI_OVERLAY: IndicatorOverlay = {
  instanceId: 'inst-rsi',
  definition: RSI_DEFINITION,
  result: {
    indicatorKey: 'rsi',
    version: 1,
    period: Period.OneHour,
    state: [
      { time: 1000, value: null },
      { time: 2000, value: 55 },
    ],
  },
  visible: true,
  color: '#ff8c3a',
};

const SIGNAL_OVERLAY: IndicatorOverlay = {
  instanceId: 'inst-signal',
  definition: SIGNAL_DEFINITION,
  result: {
    indicatorKey: 'signal',
    version: 1,
    period: Period.OneHour,
    state: [
      { time: 1000, signal: null },
      { time: 2000, signal: 'buy' },
      { time: 3000, signal: 'sell' },
    ],
  },
  visible: true,
  color: '#21c55d',
};

function chartElement(overlays: IndicatorOverlay[]) {
  return (
    <ThemeProvider>
      <Theme>
        <CandleChart
          candles={[CANDLE]}
          symbol={SYMBOL}
          period={Period.OneHour}
          range={null}
          loadOlder={() => {}}
          hasMore={false}
          overlays={overlays}
        />
      </Theme>
    </ThemeProvider>
  );
}

/** Series created with the `Line` definition only — overlay assertions ignore candle / volume series. */
function lineSeriesCreated() {
  return createdSeries.filter((entry) => entry.definition === 'Line');
}

describe('CandleChart overlays', () => {
  beforeEach(() => {
    createdSeries.length = 0;
    removedSeries.length = 0;
    markerCalls.length = 0;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('mirrors a Pane.Overlay numeric overlay into a price-pane LineSeries with whitespace gaps for null rows', () => {
    render(chartElement([SMA_OVERLAY]));

    const lines = lineSeriesCreated();
    expect({
      seriesCount: lines.length,
      paneIndex: lines[0]?.paneIndex,
      color: (lines[0]?.options as { color?: string } | undefined)?.color,
      data: lines[0]?.api.setData.mock.calls,
    }).toEqual({
      seriesCount: 1,
      paneIndex: undefined,
      color: '#3aa3ff',
      data: [[[{ time: 1 }, { time: 2, value: 105.5 }, { time: 3, value: 106 }]]],
    });
  });

  it('mirrors a Pane.Separate numeric overlay into a LineSeries on its own sub-pane (paneIndex >= 1)', () => {
    render(chartElement([RSI_OVERLAY]));

    const lines = lineSeriesCreated();
    expect({
      seriesCount: lines.length,
      paneIndex: lines[0]?.paneIndex,
      color: (lines[0]?.options as { color?: string } | undefined)?.color,
      data: lines[0]?.api.setData.mock.calls,
    }).toEqual({
      seriesCount: 1,
      paneIndex: 1,
      color: '#ff8c3a',
      data: [[[{ time: 1 }, { time: 2, value: 55 }]]],
    });
  });

  it('mirrors a RenderKind.Markers enum overlay into a setMarkers call on the price-pane candlestick series', () => {
    render(chartElement([SIGNAL_OVERLAY]));

    // No line series are created for a markers-only overlay.
    expect({
      lineSeriesCount: lineSeriesCreated().length,
      markerCalls: markerCalls,
    }).toEqual({
      lineSeriesCount: 0,
      markerCalls: [
        {
          markers: [
            { time: 2, position: 'belowBar', shape: 'arrowUp', color: '#21c55d', text: 'Buy' },
            { time: 3, position: 'aboveBar', shape: 'arrowDown', color: '#21c55d', text: 'Sell' },
          ],
        },
      ],
    });
  });

  it('reapplies visibility via applyOptions({ visible }) when an overlay is toggled hidden then shown again', () => {
    const { rerender } = render(chartElement([SMA_OVERLAY]));
    rerender(chartElement([{ ...SMA_OVERLAY, visible: false }]));
    rerender(chartElement([{ ...SMA_OVERLAY, visible: true }]));

    const line = lineSeriesCreated()[0];
    expect(line?.api.applyOptions.mock.calls).toEqual([[{ visible: false }], [{ visible: true }]]);
  });

  it('removes an overlay series from the chart when the instance is dropped from the prop', () => {
    const { rerender } = render(chartElement([SMA_OVERLAY]));
    const created = lineSeriesCreated()[0]?.api;
    rerender(chartElement([]));

    expect(removedSeries).toEqual([created]);
  });
});
