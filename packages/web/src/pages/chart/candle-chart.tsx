import type { Candle, SymbolType } from '@lametrader/core';
import {
  type CandlestickData,
  CandlestickSeries,
  createChart,
  type HistogramData,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
  type UTCTimestamp,
} from 'lightweight-charts';
import { type ReactNode, useEffect, useRef } from 'react';
import { useTheme } from '../../lib/theme-context.js';
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
 * The `lightweight-charts` candlestick canvas, with a volume sub-pane for asset
 * classes that have volume (crypto/equity; omitted for FX). The chart is created
 * once per theme/asset-class, auto-sizes to its container, and triggers
 * `loadOlder()` when the user scrolls back to the earliest loaded bar.
 *
 * @param candles - the series to render, ascending by time.
 * @param type - the symbol's asset class (decides the volume pane).
 * @param loadOlder - fetch the next older window (called on scroll-back).
 * @param hasMore - whether older history may still be available.
 */
export function CandleChart({
  candles,
  type,
  loadOlder,
  hasMore,
}: {
  candles: Candle[];
  type: SymbolType;
  loadOlder: () => void;
  hasMore: boolean;
}): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const { theme } = useTheme();
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
    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: colors.upColor,
      downColor: colors.downColor,
      borderUpColor: colors.upColor,
      borderDownColor: colors.downColor,
      wickUpColor: colors.upColor,
      wickDownColor: colors.downColor,
    });
    if (showsVolume(type)) {
      volumeSeriesRef.current = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    }
    const onRange = (range: LogicalRange | null): void => {
      if (range && range.from < 1 && paging.current.hasMore) paging.current.loadOlder();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    return () => {
      chart.remove();
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [theme, type]);

  // Push data whenever the candles (or theme-derived volume colors) change.
  useEffect(() => {
    candleSeriesRef.current?.setData(candles.map(toCandlestick));
    if (volumeSeriesRef.current) {
      const colors = chartColors(theme);
      volumeSeriesRef.current.setData(candles.map((candle) => toVolume(candle, colors)));
    }
  }, [candles, theme]);

  return <div ref={containerRef} className="h-[60vh] w-full" />;
}
