import {
  type BaselineData,
  BaselineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { type ReactNode, useEffect, useMemo, useRef } from 'react';
import { useTheme } from '../../lib/theme-context.js';
import { chartColors } from '../chart/chart-series.js';
import type { EquityPoint } from './equity-curve.js';

/**
 * The equity curve — a `lightweight-charts` `BaselineSeries` of the running
 * realized P/L after each closed trade, plotted at the trade's exit time. The
 * baseline sits at zero, so the curve renders up-colored while the strategy is
 * net-winning and down-colored while it is net-losing, reading wins/losses at a
 * glance. The chart auto-sizes to its container and fits the whole series in view.
 *
 * A thin sibling of {@link DailyPnlChart}: it owns one chart instance and one
 * series, and re-seeds the series whenever the points (or the theme palette) change.
 *
 * @param points - the cumulative-P/L points, ascending by exit time.
 */
export function EquityCurveChart({ points }: { points: readonly EquityPoint[] }): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Baseline'> | null>(null);
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
    seriesRef.current = chart.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: 0 },
      topLineColor: colors.upColor,
      bottomLineColor: colors.downColor,
    });
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [colors]);

  // Re-seed the series whenever the points (or theme-derived colors) change.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const data: BaselineData[] = points.map((point) => ({
      time: (point.time / 1000) as UTCTimestamp,
      value: point.value,
    }));
    series.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [points]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}
