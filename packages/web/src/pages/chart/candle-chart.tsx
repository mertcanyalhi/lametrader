import type { Candle, EnrichedSymbol, Period } from '@lametrader/core';
import {
  type CandlestickData,
  CandlestickSeries,
  createChart,
  type HistogramData,
  HistogramSeries,
  type IChartApi,
  type IRange,
  type ISeriesApi,
  type LogicalRange,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  captureViewport,
  DEFAULT_VISIBLE_BARS,
  getStoredViewport,
  liveLogicalRange,
  setStoredViewport,
} from '../../lib/chart-viewport.js';
import { priceDecimals } from '../../lib/format.js';
import { liveCandleForPeriod, mergeLiveCandle } from '../../lib/hooks/candles.js';
import { StreamKind } from '../../lib/stream/stream-client.types.js';
import { useStreamSubscription } from '../../lib/stream/use-stream-subscription.js';
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
 * asset classes that have volume (crypto/equity; omitted for FX), a top-left
 * overlay (symbol summary + the hovered candle's OHLC legend), and the
 * scroll-back paging trigger. The chart auto-sizes to its container.
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
 *
 * Subscribes to the symbol's live candle feed itself and applies each event to
 * the series imperatively (per frame, not via React state), so a poll that emits
 * a just-closed bar's final values *and* the next forming bar in one batch
 * applies both — the closed bar isn't left stuck at its last in-progress value.
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
  /** The latest live bar applied to the series, surfaced to the overlay legend. */
  const [liveLatest, setLiveLatest] = useState<Candle | null>(null);
  // Latest paging callbacks for the visible-range listener (avoids stale closures).
  const paging = useRef({ loadOlder, hasMore });
  paging.current = { loadOlder, hasMore };
  // Accumulate the live bars applied via `update`, keyed by time, so they can be
  // re-applied after a `setData` re-seeds the series from history alone — which
  // happens on a theme or data refresh and would otherwise drop the live tail.
  const liveBarsRef = useRef<Map<number, Candle>>(new Map());
  // Those bars belong to one (id, period); when it changes, start a fresh tail.
  // Reset during render (not an effect) so the data effect re-seeds from empty.
  const streamKey = `${symbol.id}:${period}`;
  const streamKeyRef = useRef(streamKey);
  if (streamKeyRef.current !== streamKey) {
    streamKeyRef.current = streamKey;
    liveBarsRef.current = new Map();
    setLiveLatest(null);
  }
  // The newest bar's open time (live tick or last loaded), read by the long-lived
  // capture closure to tell "following live" from "scrolled back".
  const lastBarTimeRef = useRef<number | null>(null);
  lastBarTimeRef.current = (liveLatest ?? candles.at(-1))?.time ?? null;
  // Mirror the active preset so the long-lived capture closure sees the current value.
  const rangeRef = useRef(range);
  rangeRef.current = range;
  // Capture is gated until the persisted viewport has been restored for this mount,
  // so the chart's initial auto-fit (which fires a range-change event) can't clobber
  // the stored window before we apply it.
  const captureEnabledRef = useRef(false);
  // Whether this mount has settled its initial viewport (restored or accepted default).
  const settledRef = useRef(false);

  // Create / recreate the chart when the theme or asset class (volume pane) changes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // A new chart instance starts at its default view and must re-settle.
    captureEnabledRef.current = false;
    settledRef.current = false;
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
    // Persist the user's scroll/pinch window so the next chart restores it —
    // following live (a bar count) when the right edge is on the newest bar, or
    // a fixed date window when scrolled back. Gated until restore settles, and
    // skipped while a preset range owns the view.
    const onTimeRange = (timeRange: IRange<Time> | null): void => {
      if (!captureEnabledRef.current || rangeRef.current !== null) return;
      if (timeRange && typeof timeRange.from === 'number' && typeof timeRange.to === 'number') {
        const logical = chart.timeScale().getVisibleLogicalRange();
        setStoredViewport(
          captureViewport({
            visibleFrom: timeRange.from * 1000,
            visibleTo: timeRange.to * 1000,
            lastBarTime: lastBarTimeRef.current,
            visibleBars: logical ? logical.to - logical.from : DEFAULT_VISIBLE_BARS,
          }),
        );
      }
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(onTimeRange);
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
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;
    // Match the price-axis precision to the symbol's magnitude so low-unit prices
    // (e.g. a 0.000718 crypto cross) aren't rounded to "0.00" on the axis/crosshair.
    const reference = candles.at(-1)?.close ?? candles[0]?.close;
    if (reference !== undefined) {
      const precision = priceDecimals(reference);
      candleSeries.applyOptions({
        priceFormat: { type: 'price', precision, minMove: 10 ** -precision },
      });
    }
    const colors = chartColors(theme);
    candleSeries.setData(candles.map(toCandlestick));
    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.setData(candles.map((candle) => toVolume(candle, colors)));
    }
    // setData replaces the whole series, dropping bars applied via `update`;
    // re-apply every accumulated live bar (ascending) so the live tail survives.
    const lastHistoryTime = candles.at(-1)?.time ?? Number.NEGATIVE_INFINITY;
    const liveBars = [...liveBarsRef.current.values()].sort((a, b) => a.time - b.time);
    for (const bar of liveBars) {
      if (bar.time < lastHistoryTime) continue;
      candleSeries.update(toCandlestick(bar));
      volumeSeriesRef.current?.update(toVolume(bar, colors));
    }
  }, [candles, theme]);

  // Apply each live candle event to the series the instant it arrives — directly
  // in the subscription callback, not via React state. A poll that crosses an
  // interval boundary emits the just-closed bar's final values *and* the new
  // forming bar in one batch; collapsing them through state would keep only the
  // last, leaving the closed bar stuck at its last in-progress value. Applying
  // per event (each frame) lets both land: `update` replaces the bar when the
  // time matches (forming / final correction) and appends when it is newer.
  useStreamSubscription(StreamKind.Candle, symbol.id, (event) => {
    const incoming = liveCandleForPeriod(event, period);
    if (!incoming) return;
    // Fold into the bar accumulated for this interval: a flat in-progress bar
    // (e.g. Yahoo 1m) would otherwise render as a flat line, so we keep a running
    // high/low across ticks instead of replacing it each event.
    const candle = mergeLiveCandle(liveBarsRef.current.get(incoming.time), incoming);
    liveBarsRef.current.set(candle.time, candle);
    setLiveLatest(candle);
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;
    candleSeries.update(toCandlestick(candle));
    volumeSeriesRef.current?.update(toVolume(candle, chartColors(theme)));
  });

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

  // With no preset active, restore the persisted window once this mount's data is
  // ready, so switching symbols (and reloads) keep the same view. A `live`
  // viewport shows the last N bars in logical (bar-index) coordinates and then
  // tracks new bars; a `fixed` viewport pages older history if its start predates
  // the loaded data, then restores the absolute window. Both apply after the
  // chart's auto-fit and re-enable capture.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || candles.length === 0 || settledRef.current) return;
    if (range !== null) return;
    const stored = getStoredViewport();
    if (!stored) {
      // Nothing to restore — accept the default view and start capturing.
      settledRef.current = true;
      captureEnabledRef.current = true;
      return;
    }
    if (stored.mode === 'fixed') {
      const earliestLoaded = candles[0]?.time ?? stored.to;
      if (earliestLoaded > stored.from && paging.current.hasMore) {
        paging.current.loadOlder();
        return;
      }
    }
    settledRef.current = true;
    // Defer past the chart's initial auto-fit (runs after autoSize measures the
    // container next frame) so our restored window isn't overridden, then re-enable
    // capture once it has settled.
    requestAnimationFrame(() => {
      if (stored.mode === 'live') {
        chart.timeScale().setVisibleLogicalRange(liveLogicalRange(candles.length, stored.bars));
      } else {
        chart.timeScale().setVisibleRange({
          from: (stored.from / 1000) as UTCTimestamp,
          to: (stored.to / 1000) as UTCTimestamp,
        });
      }
      requestAnimationFrame(() => {
        captureEnabledRef.current = true;
      });
    });
  }, [range, candles]);

  // Resolve the candle to inspect in the overlay: the one at the crosshair, or
  // the latest as a stable fallback when no hover is active. The live bar (when
  // present) is the freshest "latest", so the header tracks the streamed close.
  const latestCandle = liveLatest ?? candles.at(-1) ?? null;
  const inspected = useMemo<Candle | null>(() => {
    if (hoveredTime !== null) {
      // Live bars are applied to the series but aren't in the historical
      // `candles` array, so check them first — otherwise hovering a streamed bar
      // falls back to the latest and shows the wrong OHLC.
      return (
        liveBarsRef.current.get(hoveredTime) ??
        candles.find((candle) => candle.time === hoveredTime) ??
        latestCandle
      );
    }
    return latestCandle;
  }, [candles, hoveredTime, latestCandle]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0" />
      <ChartOverlay symbol={symbol} period={period} candle={inspected} />
    </div>
  );
}
