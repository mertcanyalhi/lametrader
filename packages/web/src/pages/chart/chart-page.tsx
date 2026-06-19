import type {
  Candle,
  EnrichedSymbol,
  IndicatorDefinition,
  IndicatorInstance,
  Period,
} from '@lametrader/core';
import { Callout, Flex, Link as RadixLink } from '@radix-ui/themes';
import { useQueries } from '@tanstack/react-query';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { getStoredPeriod, setStoredPeriod } from '../../lib/chart-period.js';
import { formatChange, formatChangePct, formatPrice } from '../../lib/format.js';
import { liveCandleForPeriod, useCandleStream, usePagedCandles } from '../../lib/hooks/candles.js';
import { computeIndicatorQueryOptions, useIndicatorCatalog } from '../../lib/hooks/indicators.js';
import { useProfiles } from '../../lib/hooks/profiles.js';
import { useWatchlist } from '../../lib/hooks/symbols.js';
import { useConfig } from '../../lib/hooks/use-config.js';
import { useSelectedProfile } from '../../lib/selected-profile-context.js';
import { useTheme } from '../../lib/theme-context.js';
import { CandleChart, type IndicatorOverlay } from './candle-chart.js';
import { ChartLoading } from './chart-loading.js';
import { CHART_RANGE_ORDER, type ChartRange } from './chart-range.js';
import { ChartEmptyState } from './empty-state.js';
import { IndicatorLegend, type LegendOverlay } from './indicators/indicator-legend.js';
import { IndicatorPanelDialog } from './indicators/indicator-panel-dialog.js';
import { paletteColor } from './indicators/overlay-palette.js';
import { PeriodRangeDialog } from './period-range-dialog.js';
import { ProfilePickerDialog } from './profile-picker-dialog.js';
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
  const period = params.get('period') as Period | null;
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
    <div className="grid h-full grid-rows-[minmax(0,1fr)_auto] gap-3">
      <div className="min-h-0">
        {selected.periods.includes(period) ? (
          <ChartView id={id} period={period} range={range} symbol={selected} />
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
          watchedPeriods={selected.periods}
          onApply={applyPeriodRange}
        />
        <IndicatorPanelDialog symbolType={selected.type} />
      </Flex>
    </div>
  );
}

/** Coerce a URL `?range=…` query into a {@link ChartRange}, or `null` when missing/invalid. */
function parseRange(raw: string | null): ChartRange | null {
  if (raw === null) return null;
  return CHART_RANGE_ORDER.find((value) => value === raw) ?? null;
}

/**
 * Drives the document title to `<id> · <close> <change> (<pct>%) - lametrader`
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
  if (!previous) return `${id} · ${price} - lametrader`;
  const change = latest.close - previous.close;
  const pct = previous.close === 0 ? 0 : change / previous.close;
  return `${id} · ${price} ${formatChange(change)} (${formatChangePct(pct)}) - lametrader`;
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
}: {
  id: string;
  period: Period;
  range: ChartRange | null;
  symbol: EnrichedSymbol;
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
  // Visibility lives at the page so the legend's eye toggle can mirror through
  // to the canvas's overlay series. Chart-local — not persisted across reloads.
  const [hidden, setHidden] = useState<Record<string, true>>({});
  const toggleVisible = useCallback((instanceId: string) => {
    setHidden((current) => {
      const next = { ...current };
      if (next[instanceId]) delete next[instanceId];
      else next[instanceId] = true;
      return next;
    });
  }, []);
  // The chart's crosshair time, lifted so the legend can show each overlay's
  // value at the hovered bar (and fall back to the latest when off-chart).
  const [hoveredTime, setHoveredTime] = useState<number | null>(null);
  const { canvasOverlays, legendOverlays, profile } = useChartOverlays({
    id,
    period,
    symbol,
    hidden,
  });
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
      onHoveredTimeChange={setHoveredTime}
    />
  );
  return (
    <>
      <DocumentTitle id={id} latest={latest} previous={previous} />
      {body}
      <IndicatorLegend
        overlays={legendOverlays}
        hoveredTime={hoveredTime}
        onToggleVisible={toggleVisible}
        profile={profile}
      />
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
}: {
  id: string;
  period: Period;
  symbol: EnrichedSymbol;
  hidden: Record<string, true>;
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

  const computeQueries = useQueries({
    queries: applicable.map(({ instance }) =>
      computeIndicatorQueryOptions({
        id,
        key: instance.indicatorKey,
        period,
        inputs: instance.inputs,
      }),
    ),
  });

  const canvasOverlays = useMemo<IndicatorOverlay[]>(
    () =>
      applicable.map(({ instance, definition }, index) => ({
        instanceId: instance.id,
        definition,
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
