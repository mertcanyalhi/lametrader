import type { Candle, EnrichedSymbol, Period } from '@lametrader/core';
import {
  type CandlestickData,
  CandlestickSeries,
  createChart,
  type HistogramData,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
  type MouseEventParams,
  type UTCTimestamp,
} from 'lightweight-charts';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../../lib/theme-context.js';
import { ChartOverlay } from './chart-overlay.js';
import type { ChartRange } from './chart-range.js';
import { rangeMillis } from './chart-range.js';
import { type ChartColors, chartColors, showsVolume } from './chart-series.js';

/** Map a domain candle to a `lightweight-charts` candlestick point (time in seconds). */
function toCandlestick(candle: Candle): CandlestickData {
  return {
    time: (candle.time / 1000) as UTCTimestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  };
}

/** Map a domain candle to a volume histogram point, colored by direction. */
function toVolume(candle: Candle, colors: ChartColors): HistogramData {
  const value = 'volume' in candle ? candle.volume : 0;
  return {
    time: (candle.time / 1000) as UTCTimestamp,
    value,
    color: candle.close >= candle.open ? colors.volumeUpColor : colors.volumeDownColor,
  };
}

/**
 * The `lightweight-charts` candlestick canvas, plus a volume sub-pane for
 * asset classes that have volume (crypto/equity; omitted for FX), a TV-style
 * top-left overlay (symbol summary + the hovered candle's OHLC legend), and
 * the scroll-back paging trigger. The chart auto-sizes to its container.
 *
 * The overlay's candle is the one currently under the crosshair (subscribed via
 * `subscribeCrosshairMove`); when no crosshair is active, the latest loaded
 * candle is shown.
 *
 * When `range` is set, the chart's visible time range is pinned to
 * `[now − rangeMillis(range), now]` and `loadOlder()` is invoked as needed so
 * the visible window stays fed. Range is a viewport hint — scroll-back beyond
 * the preset keeps working through the existing paging mechanism.
 *
 * @param candles - the series to render, ascending by time.
 * @param symbol - the enriched symbol the chart is rendering (drives the overlay).
 * @param period - the current charted period (the middle of the summary line).
 * @param range - the active range preset (drives the visible scale), or `null`.
 * @param loadOlder - fetch the next older window (called on scroll-back / range fill).
 * @param hasMore - whether older history may still be available.
 */
export function CandleChart({
  candles,
  symbol,
  period,
  range,
  loadOlder,
  hasMore,
}: {
  candles: Candle[];
  symbol: EnrichedSymbol;
  period: Period;
  range: ChartRange | null;
  loadOlder: () => void;
  hasMore: boolean;
}): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const { theme } = useTheme();
  /** Time (epoch ms) of the candle under the crosshair, or `null` when none. */
  const [hoveredTime, setHoveredTime] = useState<number | null>(null);
  // Latest paging callbacks for the visible-range listener (avoids stale closures).
  const paging = useRef({ loadOlder, hasMore });
  paging.current = { loadOlder, hasMore };

  // Create / recreate the chart when the theme or asset class (volume pane) changes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const colors = chartColors(theme);
    const chart: IChartApi = createChart(container, {
      autoSize: true,
      layout: { background: { color: colors.background }, textColor: colors.textColor },
      grid: { vertLines: { color: colors.gridColor }, horzLines: { color: colors.gridColor } },
      timeScale: { timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;
    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: colors.upColor,
      downColor: colors.downColor,
      borderUpColor: colors.upColor,
      borderDownColor: colors.downColor,
      wickUpColor: colors.upColor,
      wickDownColor: colors.downColor,
    });
    if (showsVolume(symbol.type)) {
      volumeSeriesRef.current = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    }
    const onRange = (logical: LogicalRange | null): void => {
      if (logical && logical.from < 1 && paging.current.hasMore) paging.current.loadOlder();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    const onCrosshair = (param: MouseEventParams): void => {
      const time = typeof param.time === 'number' ? param.time : null;
      setHoveredTime(time === null ? null : time * 1000);
    };
    chart.subscribeCrosshairMove(onCrosshair);
    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [theme, symbol.type]);

  // Push data whenever the candles (or theme-derived volume colors) change.
  useEffect(() => {
    candleSeriesRef.current?.setData(candles.map(toCandlestick));
    if (volumeSeriesRef.current) {
      const colors = chartColors(theme);
      volumeSeriesRef.current.setData(candles.map((candle) => toVolume(candle, colors)));
    }
  }, [candles, theme]);

  // When a range preset is active, drive the visible time scale to its window;
  // auto-trigger loadOlder if the earliest loaded candle doesn't yet cover it.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || candles.length === 0) return;
    if (range === null) return;
    const now = Date.now();
    const earliestNeeded = now - rangeMillis(range, now);
    const earliestLoaded = candles[0]?.time ?? now;
    if (earliestLoaded > earliestNeeded && paging.current.hasMore) {
      paging.current.loadOlder();
      return;
    }
    chart.timeScale().setVisibleRange({
      from: (earliestNeeded / 1000) as UTCTimestamp,
      to: (now / 1000) as UTCTimestamp,
    });
  }, [range, candles]);

  // Resolve the candle to inspect in the overlay: the one at the crosshair,
  // or the latest as a stable fallback when no hover is active.
  const inspected = useMemo<Candle | null>(() => {
    if (candles.length === 0) return null;
    if (hoveredTime !== null) {
      return candles.find((candle) => candle.time === hoveredTime) ?? candles.at(-1) ?? null;
    }
    return candles.at(-1) ?? null;
  }, [candles, hoveredTime]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0" />
      <ChartOverlay symbol={symbol} period={period} candle={inspected} />
    </div>
  );
}
