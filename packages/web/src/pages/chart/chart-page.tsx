import {
  type Candle,
  type EnrichedSymbol,
  type IndicatorDefinition,
  type IndicatorInstance,
  Period,
} from '@lametrader/core';
import { Callout, Flex, Link as RadixLink } from '@radix-ui/themes';
import { useQueries } from '@tanstack/react-query';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { getStoredPeriod, setStoredPeriod } from '../../lib/chart-period.js';
import { formatChangePct, formatPrice } from '../../lib/format.js';
import { liveCandleForPeriod, useCandleStream, usePagedCandles } from '../../lib/hooks/candles.js';
import { computeIndicatorQueryOptions, useIndicatorCatalog } from '../../lib/hooks/indicators.js';
import { useProfiles } from '../../lib/hooks/profiles.js';
import { useWatchlist } from '../../lib/hooks/symbols.js';
import { useConfig } from '../../lib/hooks/use-config.js';
import { useSelectedProfile } from '../../lib/selected-profile-context.js';
import { useTheme } from '../../lib/theme-context.js';
import { CandleChart, type IndicatorOverlay } from './candle-chart.js';
import { ChartEventsButton } from './chart-events-button.js';
import { ChartLoading } from './chart-loading.js';
import { CHART_RANGE_ORDER, type ChartRange } from './chart-range.js';
import { ChartRulesButton } from './chart-rules-button.js';
import { ChartEmptyState } from './empty-state.js';
import type { LegendOverlay } from './indicators/indicator-legend.js';
import { IndicatorPanelDialog } from './indicators/indicator-panel-dialog.js';
import { paletteColor } from './indicators/overlay-palette.js';
import { PeriodRangeDialog } from './period-range-dialog.js';
import { ProfilePickerDialog } from './profile-picker-dialog.js';
import { useStateChangeMarkers } from './state-change-markers.js';
import { SymbolPickerDialog } from './symbol-picker-dialog.js';

/**
 * The `/chart` page: a URL-driven candlestick chart of one watched symbol on one
 * period (`/chart?id=&period=&range=`). Reads the enriched watchlist (for the
 * symbol picker + overlay) and the config (for the default period). Bare
 * `/chart` redirects to the first watched symbol on `config.defaultPeriod`, or
 * to the watchlist when nothing is watched.
 *
 * Layout: the candle canvas fills the page, with a top-left overlay carrying
 * the symbol summary + the hovered candle's OHLC legend; the bottom bar holds
 * the symbol picker and the period+range dialog triggers, leaving room for
 * further actions in the future.
 */
export function ChartPage(): ReactNode {
  const [params, setParams] = useSearchParams();
  const watchlist = useWatchlist();
  const config = useConfig();

  if (watchlist.isPending || config.isPending) return <ChartLoading />;
  if (watchlist.isError) return <ErrorCallout message={watchlist.error.message} />;
  if (config.isError) return <ErrorCallout message={config.error.message} />;

  const symbols = watchlist.data ?? [];
  const cfg = config.data;
  const id = params.get('id');
  const period = parsePeriod(params.get('period'));
  const range = parseRange(params.get('range'));

  // Bare /chart (or a missing half) → resolve a sensible default, or bounce home.
  // The period prefers the last-selected one (persisted), as long as it's still
  // enabled in config; otherwise the config default.
  if (!id || !period) {
    const first = symbols[0];
    if (!first || !cfg) return <Navigate to="/" replace />;
    const stored = getStoredPeriod();
    const resolvedPeriod =
      period ?? (stored && cfg.periods.includes(stored) ? stored : cfg.defaultPeriod);
    const target = new URLSearchParams({ id: id ?? first.id, period: resolvedPeriod });
    return <Navigate to={`/chart?${target}`} replace />;
  }

  const selected = symbols.find((symbol) => symbol.id === id);
  if (!selected) return <Navigate to="/" replace />;

  function selectSymbol(nextId: string): void {
    const next = new URLSearchParams({ id: nextId });
    if (period) next.set('period', period);
    if (range) next.set('range', range);
    setParams(next);
  }

  function applyPeriodRange(next: { period: Period; range: ChartRange | null }): void {
    // Remember the chosen period so the chart reopens on it (bare /chart, reload).
    setStoredPeriod(next.period);
    const params = new URLSearchParams({ id: id ?? '', period: next.period });
    if (next.range) params.set('range', next.range);
    setParams(params);
  }

  return (
    <ChartLayout
      id={id}
      period={period}
      range={range}
      symbol={selected}
      symbols={symbols}
      selectSymbol={selectSymbol}
      applyPeriodRange={applyPeriodRange}
    />
  );
}

/**
 * Splits `ChartPage`'s layout from its routing/guards so the page-level
 * `hidden` visibility state can be shared between the chart canvas's legend
 * AND the bottom-bar `IndicatorPanelDialog` (both need to read + toggle it).
 */
function ChartLayout({
  id,
  period,
  range,
  symbol,
  symbols,
  selectSymbol,
  applyPeriodRange,
}: {
  id: string;
  period: Period;
  range: ChartRange | null;
  symbol: EnrichedSymbol;
  symbols: EnrichedSymbol[];
  selectSymbol: (nextId: string) => void;
  applyPeriodRange: (next: { period: Period; range: ChartRange | null }) => void;
}): ReactNode {
  const [hidden, setHidden] = useState<Record<string, true>>({});
  const toggleVisible = useCallback((instanceId: string) => {
    setHidden((current) => {
      const next = { ...current };
      if (next[instanceId]) delete next[instanceId];
      else next[instanceId] = true;
      return next;
    });
  }, []);
  return (
    <div className="grid h-full grid-rows-[minmax(0,1fr)_auto] gap-3">
      <div className="min-h-0">
        {symbol.periods.includes(period) ? (
          <ChartView
            id={id}
            period={period}
            range={range}
            symbol={symbol}
            hidden={hidden}
            toggleVisible={toggleVisible}
          />
        ) : (
          <>
            <DocumentTitle id={id} latest={null} previous={null} />
            <PeriodNotWatched period={period} />
          </>
        )}
      </div>
      <Flex
        gap="2"
        align="center"
        className="border-t border-[var(--gray-a5)] pt-3"
        role="group"
        aria-label="Chart actions"
      >
        <ProfilePickerDialog />
        <SymbolPickerDialog currentId={id} watched={symbols} onSelect={selectSymbol} />
        <PeriodRangeDialog
          period={period}
          range={range}
          watchedPeriods={symbol.periods}
          onApply={applyPeriodRange}
        />
        <IndicatorPanelDialog
          symbolType={symbol.type}
          hidden={hidden}
          onToggleVisible={toggleVisible}
        />
        <ChartRulesButton symbolId={id} />
        <ChartEventsButton symbolId={id} />
      </Flex>
    </div>
  );
}

/** Coerce a URL `?range=…` query into a {@link ChartRange}, or `null` when missing/invalid. */
function parseRange(raw: string | null): ChartRange | null {
  if (raw === null) return null;
  return CHART_RANGE_ORDER.find((value) => value === raw) ?? null;
}

/** Coerce a URL `?period=…` query into a {@link Period}, or `null` when missing/invalid. */
function parsePeriod(raw: string | null): Period | null {
  if (raw === null) return null;
  return Object.values(Period).find((value) => value === raw) ?? null;
}

/**
 * Drives the document title to `<id> <close> <arrow> <pct>% (<change>) - lametrader`
 * from the chart's latest loaded candle on the current period, so the browser
 * tab matches what's on screen (the selected period — not the default-period
 * snapshot). Restores the previous title on unmount.
 */
function DocumentTitle({
  id,
  latest,
  previous,
}: {
  id: string;
  latest: Candle | null;
  previous: Candle | null;
}): ReactNode {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = chartTitle(id, latest, previous);
    return () => {
      document.title = prevTitle;
    };
  }, [id, latest, previous]);
  return null;
}

/**
 * The document title for the chart: the latest candle's close plus its change
 * versus the previous candle's close. Falls back to just the id when no candle
 * is loaded (and to id + price when only one candle is available).
 */
function chartTitle(id: string, latest: Candle | null, previous: Candle | null): string {
  if (!latest) return `${id} - lametrader`;
  const price = formatPrice(latest.close);
  if (!previous) return `${id} ${price} - lametrader`;
  const change = latest.close - previous.close;
  const pct = previous.close === 0 ? 0 : change / previous.close;
  const arrow = change > 0 ? '▲ ' : change < 0 ? '▼ ' : '';
  return `${id} ${price} ${arrow}${formatChangePct(pct)} (${formatPrice(Math.abs(change))}) - lametrader`;
}

/**
 * The chart body for a watched symbol/period: the windowed candle feed rendered
 * as a candlestick chart, with loading, error, and "no candles" states.
 */
function ChartView({
  id,
  period,
  range,
  symbol,
  hidden,
  toggleVisible,
}: {
  id: string;
  period: Period;
  range: ChartRange | null;
  symbol: EnrichedSymbol;
  hidden: Record<string, true>;
  toggleVisible: (instanceId: string) => void;
}): ReactNode {
  const feed = usePagedCandles({ id, period });
  // The chart applies live bars itself; here the live bar only drives the tab
  // title's latest close (display, so the latest frame is enough).
  const liveCandle = liveCandleForPeriod(useCandleStream(id), period);
  const lastLoaded = feed.candles.at(-1) ?? null;
  // The live bar is the freshest "latest"; when it opens a new bar the last
  // loaded one becomes the title's previous-close baseline.
  const latest = liveCandle ?? lastLoaded;
  const previous =
    liveCandle && lastLoaded && liveCandle.time > lastLoaded.time
      ? lastLoaded
      : (feed.candles.at(-2) ?? null);
  // Bound the indicator-compute window to the candle feed the chart actually
  // loaded — the engine then scopes its candle scan to roughly that span plus
  // the indicator's warm-up margin, instead of the symbol's full history.
  const computeFrom = feed.candles[0]?.time;
  const lastLoadedCandle = feed.candles.at(-1);
  const computeTo = lastLoadedCandle ? lastLoadedCandle.time + 1 : undefined;
  const { canvasOverlays, legendOverlays, profile } = useChartOverlays({
    id,
    period,
    symbol,
    hidden,
    from: computeFrom,
    to: computeTo,
  });
  const ruleEventMarkers = useStateChangeMarkers(id);
  const body = feed.isPending ? (
    <ChartLoading />
  ) : feed.isError ? (
    <ErrorCallout message={feed.error?.message ?? 'Failed to load candles.'} />
  ) : feed.candles.length === 0 ? (
    <ChartEmptyState id={id} periods={symbol.periods} />
  ) : (
    <CandleChart
      candles={feed.candles}
      symbol={symbol}
      period={period}
      range={range}
      loadOlder={feed.loadOlder}
      hasMore={feed.hasMore}
      overlays={canvasOverlays}
      legendOverlays={legendOverlays}
      onToggleLegendVisible={toggleVisible}
      legendProfile={profile}
      ruleEventMarkers={ruleEventMarkers}
    />
  );
  return (
    <>
      <DocumentTitle id={id} latest={latest} previous={previous} />
      {body}
    </>
  );
}

/**
 * Collect the selected profile's **applicable** indicator instances (those whose
 * definition's `appliesTo` covers the chart's symbol type), issue one compute
 * call per instance via `useQueries`, and fold the results into the
 * canvas-side `IndicatorOverlay[]` and the legend-side `LegendOverlay[]`.
 *
 * Visibility is currently view-only (always `true`) — the legend's eye toggle
 * ships as a follow-up wiring; the prop drilling is in place so the legend's
 * own contract is exercised end-to-end.
 */
function useChartOverlays({
  id,
  period,
  symbol,
  hidden,
  from,
  to,
}: {
  id: string;
  period: Period;
  symbol: EnrichedSymbol;
  hidden: Record<string, true>;
  from?: number;
  to?: number;
}): {
  canvasOverlays: IndicatorOverlay[];
  legendOverlays: LegendOverlay[];
  profile: ReturnType<typeof useProfiles>['data'] extends Array<infer P> | undefined
    ? P | null
    : null;
} {
  const { profileId } = useSelectedProfile();
  const profilesQuery = useProfiles();
  const catalogQuery = useIndicatorCatalog();
  const { theme } = useTheme();

  const profile = useMemo(
    () => profilesQuery.data?.find((candidate) => candidate.id === profileId) ?? null,
    [profilesQuery.data, profileId],
  );
  const catalog = catalogQuery.data ?? [];

  /** Instances whose definition's `appliesTo` covers the current symbol type. */
  const applicable = useMemo<
    Array<{ instance: IndicatorInstance; definition: IndicatorDefinition }>
  >(() => {
    const instances = profile?.indicators ?? [];
    const rows: Array<{ instance: IndicatorInstance; definition: IndicatorDefinition }> = [];
    for (const instance of instances) {
      const definition = catalog.find((entry) => entry.key === instance.indicatorKey);
      if (!definition) continue;
      if (!definition.appliesTo.includes(symbol.type)) continue;
      rows.push({ instance, definition });
    }
    return rows;
  }, [profile, catalog, symbol.type]);

  // Hold the compute fan-out until both `from` and `to` are known — otherwise a
  // race between profile/catalog (light, resolves first) and candles (heavy,
  // resolves later) would briefly fire each compute call with no window and
  // the engine would fall back to a full-history scan, defeating this PR's fix.
  const scoped = from !== undefined && to !== undefined;
  const computeQueries = useQueries({
    queries: scoped
      ? applicable.map(({ instance }) =>
          computeIndicatorQueryOptions({
            id,
            key: instance.indicatorKey,
            period,
            inputs: instance.inputs,
            from,
            to,
          }),
        )
      : [],
  });

  const canvasOverlays = useMemo<IndicatorOverlay[]>(
    () =>
      applicable.map(({ instance, definition }, index) => ({
        instanceId: instance.id,
        definition,
        inputs: instance.inputs,
        result: computeQueries[index]?.data ?? null,
        visible: !hidden[instance.id],
        color: paletteColor(index, theme),
      })),
    [applicable, computeQueries, theme, hidden],
  );

  const legendOverlays = useMemo<LegendOverlay[]>(
    () =>
      applicable.map(({ instance, definition }, index) => ({
        instance,
        definition,
        color: paletteColor(index, theme),
        visible: !hidden[instance.id],
        state: computeQueries[index]?.data?.state ?? [],
      })),
    [applicable, computeQueries, theme, hidden],
  );

  return { canvasOverlays, legendOverlays, profile };
}

/**
 * Shown when the URL's period isn't among the symbol's watched periods — there's
 * nothing to chart, so point the user to the watchlist to add the timeframe.
 */
function PeriodNotWatched({ period }: { period: Period }): ReactNode {
  return (
    <Callout.Root color="amber">
      <Callout.Text>
        This symbol is not watched on the {period} timeframe. Add it from the{' '}
        <RadixLink asChild>
          <Link to="/">watchlist</Link>
        </RadixLink>{' '}
        to chart this period.
      </Callout.Text>
    </Callout.Root>
  );
}

/** A red error callout for a failed watchlist/config/candles load. */
function ErrorCallout({ message }: { message: string }): ReactNode {
  return (
    <Callout.Root color="red" role="alert">
      <Callout.Text>{message}</Callout.Text>
    </Callout.Root>
  );
}
