import {
  createChart,
  type HistogramData,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { type ReactNode, useEffect, useMemo, useRef } from 'react';
import { useTheme } from '../../lib/theme-context.js';
import { chartColors } from '../chart/chart-series.js';
import type { DailyPnlBar } from './daily-pnl.js';

/**
 * The Daily P&L histogram — a `lightweight-charts` `HistogramSeries` of per-day
 * realized P&L, each bar the summed net P&L of the trades that exited that UTC
 * day. Winning days render up-colored, losing days down-colored. The chart
 * auto-sizes to its container and fits the whole series into view.
 *
 * A thin sibling of {@link CandleChart}: it owns one chart instance and one
 * series, and re-seeds the series whenever the bucketed bars (or the theme
 * palette) change.
 *
 * @param bars - the per-day P&L buckets, ascending by day.
 */
export function DailyPnlChart({ bars }: { bars: readonly DailyPnlBar[] }): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const { theme } = useTheme();
  const colors = useMemo(() => chartColors(theme), [theme]);

  // Create / recreate the chart when the theme palette changes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { color: colors.background }, textColor: colors.textColor },
      grid: { vertLines: { color: colors.gridColor }, horzLines: { color: colors.gridColor } },
      timeScale: { timeVisible: false, secondsVisible: false },
    });
    chartRef.current = chart;
    seriesRef.current = chart.addSeries(HistogramSeries, { priceFormat: { type: 'price' } });
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [colors]);

  // Re-seed the series whenever the bars (or theme-derived colors) change.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const data: HistogramData[] = bars.map((bar) => ({
      time: (bar.day / 1000) as UTCTimestamp,
      value: bar.pnl,
      color: bar.pnl >= 0 ? colors.upColor : colors.downColor,
    }));
    series.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [bars, colors]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}
