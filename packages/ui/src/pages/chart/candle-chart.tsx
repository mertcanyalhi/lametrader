import {
  type Candle,
  type EnrichedSymbol,
  type EnumStateFieldDescriptor,
  FieldType,
  type IndicatorComputeResult,
  type IndicatorDefinition,
  type IndicatorStatePoint,
  Pane,
  type Period,
  type Profile,
  periodMillis,
  RenderKind,
  StateValueType,
} from '@lametrader/core';
import {
  type CandlestickData,
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  type HistogramData,
  HistogramSeries,
  type IChartApi,
  type IRange,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  LineSeries,
  LineType,
  type LogicalRange,
  type MouseEventParams,
  type SeriesMarker,
  type SeriesMarkerBarPosition,
  type SeriesMarkerShape,
  type Time,
  type UTCTimestamp,
  type WhitespaceData,
} from 'lightweight-charts';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formingBucketCandle } from '../../lib/aggregate-candles.js';
import {
  captureViewport,
  DEFAULT_VISIBLE_BARS,
  getStoredViewport,
  liveLogicalRange,
  rollingWindowBars,
  setStoredViewport,
} from '../../lib/chart-viewport.js';
import { priceDecimals } from '../../lib/format.js';
import { liveCandleForPeriod } from '../../lib/hooks/candles.js';
import { getLogger } from '../../lib/log.js';
import { finestFinerPeriod } from '../../lib/periods.js';
import type { CandleEvent } from '../../lib/stream/stream-client.types.js';
import { StreamKind } from '../../lib/stream/stream-client.types.js';
import { useStreamSubscription } from '../../lib/stream/use-stream-subscription.js';
import { useTheme } from '../../lib/theme-context.js';
import { ChartOverlay } from './chart-overlay.js';
import type { ChartRange } from './chart-range.js';
import { rangeMillis } from './chart-range.js';
import { type ChartColors, chartColors, showsVolume } from './chart-series.js';
import type { LegendOverlay } from './indicators/indicator-legend.js';
import {
  type StateOverlay,
  stateOverlayToLineData,
  stateOverlayToMarkers,
} from './states/state-overlay.js';

const log = getLogger('chart-paging');

/** No-op callback used when no `onToggleLegendVisible` is passed (read-only legend). */
const noop = (): void => {};

/**
 * One indicator's data + presentation, as passed to the chart canvas.
 *
 * The chart mirrors the array into per-state-descriptor series (line or markers),
 * keyed by `instanceId+stateKey`, so the same overlay can re-render new data
 * without re-creating its series.
 */
export interface IndicatorOverlay {
  /** Stable id — the attached profile instance's id; keys the chart's series map. */
  instanceId: string;
  /** Definition for the indicator (provides state descriptors driving render). */
  definition: IndicatorDefinition;
  /** Validated input values — keys the live `subscribe-indicator` tuple alongside `(symbol, period, definition.key)`. */
  inputs: Record<string, unknown>;
  /** Computed historical state series; `null` while pending or after a failure. */
  result: IndicatorComputeResult | null;
  /** Whether the overlay's series are currently shown (legend eye toggle). */
  visible: boolean;
  /** Palette-derived colour applied to every series belonging to this overlay. */
  color: string;
}

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
 * When `follow` is set (backtest replay), each candle growth re-frames the visible
 * scale to a rolling fixed-width window on the newest bar instead of restoring or
 * persisting the shared viewport — see the `follow` prop.
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
  follow = false,
  overlays = [],
  stateOverlays = [],
  legendOverlays = [],
  onToggleLegendVisible,
  legendProfile = null,
  eventMarkers = [],
  onLiveCandle,
}: {
  candles: Candle[];
  symbol: EnrichedSymbol;
  period: Period;
  range: ChartRange | null;
  loadOlder: () => void;
  hasMore: boolean;
  /**
   * Called with each live bar the chart applies to the series — the charted
   * period's own frame, or the forming bar folded from a finer stream frame for
   * a coarser charted period. Lets the page drive the tab title from the same
   * forming bar the chart draws, so it ticks between coarse boundaries too.
   */
  onLiveCandle?: (candle: Candle) => void;
  /**
   * Backtest-replay rolling window: when set, each candle growth re-frames the
   * visible scale to a fixed-width window ending on the newest bar (default
   * `ROLLING_WINDOW_BARS`, or the user's current width if wider), instead of
   * restoring/persisting the shared `chart-viewport`. The `/chart` page leaves
   * this off and keeps its restore/capture behaviour.
   */
  follow?: boolean;
  overlays?: ReadonlyArray<IndicatorOverlay>;
  /**
   * One row per state key currently selected on the chart's States panel —
   * rendered as a step-line (numeric) or markers (bool/string/enum) on the
   * candle pane.
   */
  stateOverlays?: ReadonlyArray<StateOverlay>;
  /** One row per applicable indicator instance, rendered in the top-left overlay column. */
  legendOverlays?: LegendOverlay[];
  /** Dispatched when an indicator row's eye toggle is clicked. */
  onToggleLegendVisible?: (instanceId: string) => void;
  /** The selected profile — passed through to the legend so its remove `x` can detach. */
  legendProfile?: Profile | null;
  /**
   * Rule-event markers to render on the candle series via a single shared
   * `createSeriesMarkers` plugin.
   *
   * The chart attaches the plugin lazily (no work when the list is empty)
   * and calls `setMarkers` on each prop change so a live event simply re-runs
   * the descriptor mapping.
   */
  eventMarkers?: ReadonlyArray<SeriesMarker<Time>>;
}): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  /**
   * Latest live state row per instance, keyed by `instanceId`. Bumps the legend
   * value column when no crosshair is active (the legend reads the latest
   * non-null row); the chart's line series is updated imperatively via
   * `series.update(...)` at event time, so this is legend-only state.
   */
  const [liveStates, setLiveStates] = useState<Record<string, IndicatorStatePoint>>({});
  /**
   * Per-instance line series for overlay descriptors (Pane.Overlay + Pane.Separate),
   * keyed by `instanceId+stateKey` so each state field carries its own series.
   */
  const overlayLineRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());
  /** Per-instance marker plugins for `RenderKind.Markers` descriptors. */
  const overlayMarkersRef = useRef<Map<string, ISeriesMarkersPluginApi<Time>>>(new Map());
  /**
   * Per-state-key line series for numeric {@link StateOverlay}s, keyed by
   * the state key (unique within a `(profile, symbol)` selection).
   */
  const stateLineRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());
  /**
   * Per-state-key marker plugin for non-numeric {@link StateOverlay}s,
   * keyed by the state key.
   */
  const stateMarkersRef = useRef<Map<string, ISeriesMarkersPluginApi<Time>>>(new Map());
  /**
   * The shared rule-event marker plugin — one per chart instance. Lazily
   * attached the first time a non-empty `eventMarkers` arrives so an unused
   * descriptor costs nothing.
   */
  const eventMarkersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  /**
   * Last `eventMarkers` array reference applied to the plugin. The sync
   * effect re-runs on `chartVersion` bumps as well as prop changes; this ref
   * lets it skip the redundant `setMarkers` call when the reference hasn't
   * actually moved (mirrors the `lastResultMap` deduping in `syncMarkers`).
   */
  const lastEventMarkersRef = useRef<ReadonlyArray<SeriesMarker<Time>> | null>(null);
  /**
   * Last applied `visible` per series key, so the sync only calls `applyOptions`
   * on a change — never on initial create (the initial state ships with
   * `options.visible`) and never twice for the same value.
   */
  const overlayVisibilityRef = useRef<Map<string, boolean>>(new Map());
  /**
   * Last applied compute-result reference per series key. A re-sync with the
   * same `overlay.result` reference (e.g. the `chartVersion` bump triggers a
   * second run on the same chart) is a no-op rather than a redundant setData /
   * setMarkers call.
   */
  const overlayLastResultRef = useRef<Map<string, IndicatorComputeResult | null>>(new Map());
  /**
   * Next `paneIndex` for a separate-pane series. Bumps per separate descriptor
   * created in a chart's lifetime; resets when the chart is re-created.
   */
  const nextPaneIndexRef = useRef(1);
  const { theme } = useTheme();
  // One palette per theme — the live-tick path applies it per frame, so don't
  // reallocate it on every event.
  const colors = useMemo(() => chartColors(theme), [theme]);
  /** Time (epoch ms) of the candle under the crosshair, or `null` when none. */
  const [hoveredTime, setHoveredTime] = useState<number | null>(null);
  /** The latest live bar applied to the series, surfaced to the overlay legend. */
  const [liveLatest, setLiveLatest] = useState<Candle | null>(null);
  /**
   * Bumps each time the chart is re-created (theme / symbol-type change). The
   * overlay-sync effect lists it as a dep so it re-runs after a recreate (the
   * maps are cleared, so every overlay gets re-added to the fresh chart).
   */
  const [chartVersion, setChartVersion] = useState(0);
  // Latest paging callbacks for the visible-range listener (avoids stale closures).
  const paging = useRef({ loadOlder, hasMore });
  paging.current = { loadOlder, hasMore };
  // Accumulate the live bars applied via `update`, keyed by time, so they can be
  // re-applied after a `setData` re-seeds the series from history alone — which
  // happens on a theme or data refresh and would otherwise drop the live tail.
  const liveBarsRef = useRef<Map<number, Candle>>(new Map());
  // The finest watched period strictly finer than the charted one, or `null` when
  // the charted period is itself the finest (the common case, no folding). Its
  // live frames are folded into the charted period's forming bar so a coarser
  // charted period ticks between its own, less frequent, boundaries.
  const finerPeriod = useMemo(
    () => finestFinerPeriod(symbol.periods, period),
    [symbol.periods, period],
  );
  // Finer-period frames in the charted period's current forming bucket, keyed by
  // time; folded via `formingBucketCandle`. Empty (and unused) when `finerPeriod`
  // is `null`. Reset with the stream key below.
  const finerBarsRef = useRef<Map<number, Candle>>(new Map());
  // Those bars belong to one (id, period); when it changes, start a fresh tail.
  // Reset during render (not an effect) so the data effect re-seeds from empty.
  const streamKey = `${symbol.id}:${period}`;
  const streamKeyRef = useRef(streamKey);
  if (streamKeyRef.current !== streamKey) {
    streamKeyRef.current = streamKey;
    liveBarsRef.current = new Map();
    finerBarsRef.current = new Map();
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
      if (logical && logical.from < 1 && paging.current.hasMore) {
        // ponytail: debug loop instrumentation, remove once diagnosed
        log.debug({ logicalFrom: logical.from, logicalTo: logical.to }, 'onRange → loadOlder');
        paging.current.loadOlder();
      }
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
    // Signal the overlay-sync effect that the chart is freshly created and the
    // overlay maps (cleared in the cleanup below) need to be repopulated.
    setChartVersion((v) => v + 1);
    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      // The chart's destruction takes every series with it — clear the per-overlay
      // bookkeeping so the next overlay-sync treats every overlay as new on the
      // freshly-created chart.
      overlayLineRef.current.clear();
      overlayMarkersRef.current.clear();
      overlayVisibilityRef.current.clear();
      overlayLastResultRef.current.clear();
      stateLineRef.current.clear();
      stateMarkersRef.current.clear();
      eventMarkersPluginRef.current = null;
      lastEventMarkersRef.current = null;
      nextPaneIndexRef.current = 1;
    };
  }, [colors, symbol.type]);

  // Mirror the `stateOverlays[]` prop into per-state-key series. Numeric
  // overlays add a step-line on the price pane (`LineSeries`); non-numeric
  // ones attach markers on the candle series. Removals on numeric overlays
  // come through as whitespace gaps (see `stateOverlayToLineData`).
  //
  // biome-ignore lint/correctness/useExhaustiveDependencies: chartVersion is a signal-only dep that drives re-sync after chart recreate.
  useEffect(() => {
    const chart = chartRef.current;
    const candle = candleSeriesRef.current;
    if (!chart || !candle) return;
    syncStateOverlays({
      chart,
      candle,
      overlays: stateOverlays,
      lineMap: stateLineRef.current,
      markersMap: stateMarkersRef.current,
    });
  }, [stateOverlays, chartVersion]);

  // Mirror the `overlays[]` prop into per-state-descriptor series, diffing the
  // current set against the previous one. `chartVersion` bumps after each chart
  // re-creation (theme / symbol-type change), so this effect re-runs against
  // the fresh chart and treats every overlay as new. The body reads the chart
  // through a ref (not a render value), so Biome can't see the coupling —
  // hence the ignore on the next line.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chartVersion is a signal-only dep that drives re-sync after chart recreate.
  useEffect(() => {
    const chart = chartRef.current;
    const candle = candleSeriesRef.current;
    if (!chart || !candle) return;
    syncOverlays({
      chart,
      candle,
      overlays,
      lineMap: overlayLineRef.current,
      markersMap: overlayMarkersRef.current,
      visibilityMap: overlayVisibilityRef.current,
      lastResultMap: overlayLastResultRef.current,
      paneCursor: nextPaneIndexRef,
    });
  }, [overlays, chartVersion]);

  // Mirror the `eventMarkers` prop into one shared marker plugin on the candle
  // series, attached lazily so an unused descriptor costs nothing.
  // The `chartVersion` bump after a chart recreate clears the plugin ref above,
  // so the first non-empty list after recreate re-attaches; otherwise this
  // skips when the prop reference hasn't moved (chartVersion-only re-runs).
  // biome-ignore lint/correctness/useExhaustiveDependencies: chartVersion drives re-attach after chart recreate.
  useEffect(() => {
    const candle = candleSeriesRef.current;
    if (!candle) return;
    if (eventMarkers.length === 0 && eventMarkersPluginRef.current === null) return;
    if (lastEventMarkersRef.current === eventMarkers) return;
    if (eventMarkersPluginRef.current === null) {
      eventMarkersPluginRef.current = createSeriesMarkers(candle, [...eventMarkers]);
    } else {
      eventMarkersPluginRef.current.setMarkers([...eventMarkers]);
    }
    lastEventMarkersRef.current = eventMarkers;
  }, [eventMarkers, chartVersion]);

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
  }, [candles, colors]);

  // Apply each live candle event to the series the instant it arrives — directly
  // in the subscription callback, not via React state. A poll that crosses an
  // interval boundary emits the just-closed bar's final values *and* the new
  // forming bar in one batch; collapsing them through state would keep only the
  // last, leaving the closed bar stuck at its last in-progress value. Applying
  // per event (each frame) lets both land: `update` replaces the bar when the
  // time matches (forming / final correction) and appends when it is newer.
  // Fold a finer-than-charted stream frame into the charted period's forming bar:
  // buffer the frame under `finerPeriod`, drop any older than the current bucket,
  // and re-aggregate the bucket via `formingBucketCandle`. Returns `null` when
  // folding is off (`finerPeriod` is `null`) or the frame is a different period.
  const foldFinerFrame = useCallback(
    (event: CandleEvent): Candle | null => {
      if (finerPeriod === null || event.period !== finerPeriod) return null;
      const buffer = finerBarsRef.current;
      buffer.set(event.candle.time, event.candle);
      const bucketStart =
        Math.floor(event.candle.time / periodMillis(period)) * periodMillis(period);
      for (const time of buffer.keys()) {
        if (time < bucketStart) buffer.delete(time);
      }
      return formingBucketCandle(
        [...buffer.values()].sort((a, b) => a.time - b.time),
        period,
      );
    },
    [finerPeriod, period],
  );

  useStreamSubscription(StreamKind.Candle, symbol.id, (event) => {
    // The charted period's own frame, or — for a coarser charted period — the
    // forming bar folded from the finest finer stream frame. `finerPeriod` is
    // `null` when the charted period is the finest, so this is inert there and
    // the shortest-period path is byte-for-byte the strict-match behaviour.
    const candle = liveCandleForPeriod(event, period) ?? foldFinerFrame(event);
    if (!candle) return;
    liveBarsRef.current.set(candle.time, candle);
    setLiveLatest(candle);
    onLiveCandle?.(candle);
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;
    candleSeries.update(toCandlestick(candle));
    volumeSeriesRef.current?.update(toVolume(candle, colors));
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
    // ponytail: debug loop instrumentation, remove once diagnosed
    log.debug(
      {
        source: 'range-preset-effect',
        range,
        earliestLoaded,
        earliestNeeded,
        gapMs: earliestLoaded - earliestNeeded,
        hasMore: paging.current.hasMore,
        willPage: earliestLoaded > earliestNeeded && paging.current.hasMore,
      },
      'range/candles effect',
    );
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
    // Follow mode owns the viewport (rolling window below) and must not touch the
    // shared persisted window — skip restore/capture entirely.
    if (range !== null || follow) return;
    const stored = getStoredViewport();
    if (!stored) {
      // Nothing to restore — accept the default view and start capturing.
      settledRef.current = true;
      captureEnabledRef.current = true;
      return;
    }
    if (stored.mode === 'fixed') {
      const earliestLoaded = candles[0]?.time ?? stored.to;
      // ponytail: debug loop instrumentation, remove once diagnosed
      log.debug(
        {
          source: 'viewport-restore-effect',
          storedFrom: stored.from,
          storedTo: stored.to,
          earliestLoaded,
          gapMs: earliestLoaded - stored.from,
          hasMore: paging.current.hasMore,
          willPage: earliestLoaded > stored.from && paging.current.hasMore,
        },
        'fixed viewport restore',
      );
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
  }, [range, candles, follow]);

  // Backtest replay: on each candle growth, keep a rolling fixed-width window on
  // the newest bar (default 20, or the user's current width if they've widened
  // it) so the chart follows the replay instead of zooming out to fit everything.
  useEffect(() => {
    if (!follow) return;
    const chart = chartRef.current;
    if (!chart || candles.length === 0) return;
    const bars = rollingWindowBars(chart.timeScale().getVisibleLogicalRange());
    chart.timeScale().setVisibleLogicalRange(liveLogicalRange(candles.length, bars));
  }, [candles, follow]);

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

  // Apply one live indicator-state event for `overlay`: update each Number state
  // descriptor's line series via `series.update(...)` and bump the per-instance
  // map the legend reads its latest value from.
  const handleLiveState = useCallback(
    (overlay: IndicatorOverlay, state: IndicatorStatePoint): void => {
      for (const descriptor of overlay.definition.state) {
        if (descriptor.type !== FieldType.Number) continue;
        const series = overlayLineRef.current.get(seriesKey(overlay.instanceId, descriptor.key));
        const value = (state as Record<string, unknown>)[descriptor.key];
        if (series && typeof value === 'number') {
          series.update({ time: (state.time / 1000) as Time, value });
        }
      }
      setLiveStates((current) => ({ ...current, [overlay.instanceId]: state }));
    },
    [],
  );

  // Drop live state for overlays that have been detached, so the map doesn't
  // retain entries for instances no longer on the chart.
  useEffect(() => {
    const live = new Set(overlays.map((overlay) => overlay.instanceId));
    setLiveStates((current) => {
      const kept = Object.entries(current).filter(([instanceId]) => live.has(instanceId));
      if (kept.length === Object.keys(current).length) return current;
      return Object.fromEntries(kept);
    });
  }, [overlays]);

  // Augment the historical legend rows with each instance's latest live state,
  // so the legend's value column ticks live (mirrors the OHLCV row's live tick).
  // Appending at the end places the live point at the tail of the reverse-find
  // for "latest non-null row", which is what the legend picks for no-crosshair.
  const liveLegendOverlays = useMemo(
    () =>
      legendOverlays.map((legendOverlay) => {
        const live = liveStates[legendOverlay.instance.id];
        if (!live) return legendOverlay;
        return { ...legendOverlay, state: [...legendOverlay.state, live] };
      }),
    [legendOverlays, liveStates],
  );

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0" />
      {overlays.map((overlay) => (
        <OverlayLive
          key={overlay.instanceId}
          overlay={overlay}
          symbolId={symbol.id}
          period={period}
          onState={handleLiveState}
        />
      ))}
      <ChartOverlay
        symbol={symbol}
        period={period}
        candle={inspected}
        legendOverlays={liveLegendOverlays}
        hoveredTime={hoveredTime}
        onToggleVisible={onToggleLegendVisible ?? noop}
        profile={legendProfile}
      />
    </div>
  );
}

/**
 * One overlay's `subscribe-indicator` lifecycle — opens the subscription for the
 * overlay's `(symbol, period, definition.key, inputs)` tuple over the shared
 * stream client and reports each frame back to `onState`. Renders nothing.
 *
 * Sits as a child so its hook lives inside a stable position in the render
 * tree (hooks-in-loops rule). Unmounting it (overlay removed from the prop)
 * releases the upstream subscription via the client's ref-counted teardown.
 */
function OverlayLive({
  overlay,
  symbolId,
  period,
  onState,
}: {
  overlay: IndicatorOverlay;
  symbolId: string;
  period: Period;
  onState: (overlay: IndicatorOverlay, state: IndicatorStatePoint) => void;
}): ReactNode {
  const inputsHash = JSON.stringify(overlay.inputs);
  useStreamSubscription(
    StreamKind.Indicator,
    {
      id: symbolId,
      period,
      indicator: { key: overlay.definition.key, inputs: overlay.inputs },
    },
    (event) => onState(overlay, event.state),
    [symbolId, period, overlay.definition.key, inputsHash],
  );
  return null;
}

/**
 * Compose a unique series key from an instance id and a state descriptor key,
 * so the overlay maps can hold one entry per `(instance, state-field)` pair.
 */
function seriesKey(instanceId: string, stateKey: string): string {
  return `${instanceId}::${stateKey}`;
}

/**
 * Diff the latest `overlays[]` against the chart's current series:
 *   1. Remove series belonging to instances no longer in the list (`removeSeries`
 *      for line series, `detach()` for marker plugins).
 *   2. For each remaining overlay, create any missing series + plugin (initial
 *      `visible` baked into options so no extra `applyOptions` fires), push the
 *      latest data, and `applyOptions({ visible })` only when visibility changed
 *      since the previous sync.
 */
function syncOverlays(args: {
  chart: IChartApi;
  candle: ISeriesApi<'Candlestick'>;
  overlays: ReadonlyArray<IndicatorOverlay>;
  lineMap: Map<string, ISeriesApi<'Line'>>;
  markersMap: Map<string, ISeriesMarkersPluginApi<Time>>;
  visibilityMap: Map<string, boolean>;
  lastResultMap: Map<string, IndicatorComputeResult | null>;
  paneCursor: { current: number };
}): void {
  const { chart, candle, overlays, lineMap, markersMap, visibilityMap, lastResultMap, paneCursor } =
    args;
  const liveIds = new Set(overlays.map((o) => o.instanceId));

  // Drop any series belonging to an instance that left the overlay list.
  for (const [key, series] of [...lineMap.entries()]) {
    const instanceId = key.split('::')[0] ?? '';
    if (!liveIds.has(instanceId)) {
      chart.removeSeries(series);
      lineMap.delete(key);
      visibilityMap.delete(key);
      lastResultMap.delete(key);
    }
  }
  for (const [key, plugin] of [...markersMap.entries()]) {
    const instanceId = key.split('::')[0] ?? '';
    if (!liveIds.has(instanceId)) {
      plugin.detach();
      markersMap.delete(key);
      visibilityMap.delete(key);
      lastResultMap.delete(key);
    }
  }

  // Add / refresh each desired overlay's series.
  for (const overlay of overlays) {
    if (!overlay.result) continue;
    for (const descriptor of overlay.definition.state) {
      const key = seriesKey(overlay.instanceId, descriptor.key);
      const isMarkers = descriptor.render === RenderKind.Markers;
      if (isMarkers && descriptor.type === FieldType.Enum) {
        syncMarkers({
          candle,
          overlay,
          descriptor,
          key,
          markersMap,
          visibilityMap,
          lastResultMap,
        });
      } else if (descriptor.type === FieldType.Number) {
        syncLine({
          chart,
          overlay,
          descriptor,
          key,
          lineMap,
          visibilityMap,
          lastResultMap,
          paneCursor,
        });
      }
    }
  }
}

/**
 * Ensure a `LineSeries` exists for the descriptor, set its data (warm-up nulls
 * mapped to whitespace gaps), and toggle visibility only when it changed.
 */
function syncLine(args: {
  chart: IChartApi;
  overlay: IndicatorOverlay;
  descriptor: { key: string; pane?: Pane };
  key: string;
  lineMap: Map<string, ISeriesApi<'Line'>>;
  visibilityMap: Map<string, boolean>;
  lastResultMap: Map<string, IndicatorComputeResult | null>;
  paneCursor: { current: number };
}): void {
  const { chart, overlay, descriptor, key, lineMap, visibilityMap, lastResultMap, paneCursor } =
    args;
  if (!overlay.result) return;
  let series = lineMap.get(key);
  const isNew = !series;
  if (!series) {
    const paneIndex = descriptor.pane === Pane.Separate ? paneCursor.current++ : undefined;
    series = chart.addSeries(
      LineSeries,
      { color: overlay.color, visible: overlay.visible },
      paneIndex,
    );
    lineMap.set(key, series);
    visibilityMap.set(key, overlay.visible);
  }
  // Skip setData when the result reference hasn't moved since the last sync —
  // avoids redundant work (and redundant mock calls in tests) when the
  // overlay-sync effect re-runs from a `chartVersion` bump alone.
  if (isNew || lastResultMap.get(key) !== overlay.result) {
    const data: (LineData<Time> | WhitespaceData<Time>)[] = overlay.result.state.map((row) => {
      const value = (row as Record<string, unknown>)[descriptor.key];
      const time = (row.time / 1000) as Time;
      if (typeof value === 'number') return { time, value };
      return { time };
    });
    series.setData(data);
    lastResultMap.set(key, overlay.result);
  }
  const wasVisible = visibilityMap.get(key);
  if (wasVisible !== overlay.visible) {
    series.applyOptions({ visible: overlay.visible });
    visibilityMap.set(key, overlay.visible);
  }
}

/**
 * Ensure a marker plugin is attached to the candle series for this descriptor,
 * and apply the firing-bar markers (skipping `null` rows). Visibility is mapped
 * to "show markers" vs "clear markers" — `lightweight-charts`'s plugin API has
 * no `visible` option, so an invisible markers overlay is one with an empty list.
 */
function syncMarkers(args: {
  candle: ISeriesApi<'Candlestick'>;
  overlay: IndicatorOverlay;
  descriptor: EnumStateFieldDescriptor;
  key: string;
  markersMap: Map<string, ISeriesMarkersPluginApi<Time>>;
  visibilityMap: Map<string, boolean>;
  lastResultMap: Map<string, IndicatorComputeResult | null>;
}): void {
  const { candle, overlay, descriptor, key, markersMap, visibilityMap, lastResultMap } = args;
  if (!overlay.result) return;
  const plugin = markersMap.get(key);
  const isNew = !plugin;
  const visibilityChanged = visibilityMap.get(key) !== overlay.visible;
  const resultChanged = lastResultMap.get(key) !== overlay.result;
  // Skip the create / setMarkers call when nothing observable changed — a
  // re-sync from a `chartVersion` bump alone would otherwise emit a redundant
  // marker call (the test asserts exactly one).
  if (!isNew && !visibilityChanged && !resultChanged) return;
  const markers = overlay.visible ? buildMarkers(overlay.result, descriptor, overlay.color) : [];
  if (!plugin) {
    markersMap.set(key, createSeriesMarkers(candle, markers));
  } else {
    plugin.setMarkers(markers);
  }
  visibilityMap.set(key, overlay.visible);
  lastResultMap.set(key, overlay.result);
}

/**
 * Map an enum state series to `lightweight-charts` markers — one per firing
 * bar. The first option in the descriptor (by index) renders as an up-arrow
 * below the bar, the second as a down-arrow above the bar; further options
 * fall back to a neutral circle in the bar.
 */
function buildMarkers(
  result: IndicatorComputeResult,
  descriptor: EnumStateFieldDescriptor,
  color: string,
): SeriesMarker<Time>[] {
  const optionIndex = new Map<string, number>();
  for (const [idx, option] of descriptor.options.entries()) {
    optionIndex.set(option.value, idx);
  }
  const markers: SeriesMarker<Time>[] = [];
  for (const row of result.state) {
    const value = (row as Record<string, unknown>)[descriptor.key];
    if (typeof value !== 'string') continue;
    const idx = optionIndex.get(value);
    if (idx === undefined) continue;
    const option = descriptor.options[idx];
    if (!option) continue;
    const placement = MARKER_PLACEMENTS[idx] ?? NEUTRAL_PLACEMENT;
    markers.push({
      time: (row.time / 1000) as Time,
      position: placement.position,
      shape: placement.shape,
      color,
      text: option.label,
    });
  }
  return markers;
}

/** Position + shape per option index — kept short and readable. */
const MARKER_PLACEMENTS: ReadonlyArray<{
  position: SeriesMarkerBarPosition;
  shape: SeriesMarkerShape;
}> = [
  { position: 'belowBar', shape: 'arrowUp' },
  { position: 'aboveBar', shape: 'arrowDown' },
];

/**
 * Diff the latest `stateOverlays[]` against the chart's current state-series:
 *
 *   1. Remove series / marker plugins for keys no longer in the list.
 *   2. For each remaining overlay, create the missing series (numeric →
 *      step-line via `LineSeries`) or marker plugin (non-numeric → markers
 *      on the candle series), then push the latest data.
 *
 * Visibility is enforced by setting the data to `[]` for invisible numeric
 * overlays (the line series hides) and an empty marker list for invisible
 * non-numeric overlays (no plugin `visible` flag exists). Step-line breaks
 * are encoded as whitespace points in `stateOverlayToLineData`.
 *
 * Lazy: no incremental diff of data points — `setData` / `setMarkers` is
 * idempotent and cheap for the per-symbol cardinalities the chart expects.
 */
function syncStateOverlays(args: {
  chart: IChartApi;
  candle: ISeriesApi<'Candlestick'>;
  overlays: ReadonlyArray<StateOverlay>;
  lineMap: Map<string, ISeriesApi<'Line'>>;
  markersMap: Map<string, ISeriesMarkersPluginApi<Time>>;
}): void {
  const { chart, candle, overlays, lineMap, markersMap } = args;
  const liveKeys = new Set(overlays.map((overlay) => overlay.key));
  for (const [key, series] of [...lineMap.entries()]) {
    if (!liveKeys.has(key)) {
      chart.removeSeries(series);
      lineMap.delete(key);
    }
  }
  for (const [key, plugin] of [...markersMap.entries()]) {
    if (!liveKeys.has(key)) {
      plugin.detach();
      markersMap.delete(key);
    }
  }
  for (const overlay of overlays) {
    if (overlay.valueType === StateValueType.Number) {
      let series = lineMap.get(overlay.key);
      if (!series) {
        series = chart.addSeries(LineSeries, {
          color: overlay.color,
          lineType: LineType.WithSteps,
          visible: overlay.visible,
        });
        lineMap.set(overlay.key, series);
      } else {
        series.applyOptions({ visible: overlay.visible });
      }
      series.setData(overlay.visible ? stateOverlayToLineData(overlay.entries) : []);
    } else {
      const markers = overlay.visible ? stateOverlayToMarkers(overlay.entries, overlay.color) : [];
      const plugin = markersMap.get(overlay.key);
      if (!plugin) {
        markersMap.set(overlay.key, createSeriesMarkers(candle, markers));
      } else {
        plugin.setMarkers(markers);
      }
    }
  }
}

/** Fallback for any option beyond the first two — a neutral in-bar circle. */
const NEUTRAL_PLACEMENT: { position: SeriesMarkerBarPosition; shape: SeriesMarkerShape } = {
  position: 'inBar',
  shape: 'circle',
};
