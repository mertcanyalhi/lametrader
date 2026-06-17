import type { Candle, EnrichedSymbol, Period } from '@lametrader/core';
import { Callout, Flex, Link as RadixLink } from '@radix-ui/themes';
import { type ReactNode, useEffect } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { getStoredPeriod, setStoredPeriod } from '../../lib/chart-period.js';
import { formatChange, formatChangePct, formatPrice } from '../../lib/format.js';
import { liveCandleForPeriod, useCandleStream, usePagedCandles } from '../../lib/hooks/candles.js';
import { useWatchlist } from '../../lib/hooks/symbols.js';
import { useConfig } from '../../lib/hooks/use-config.js';
import { CandleChart } from './candle-chart.js';
import { ChartLoading } from './chart-loading.js';
import { CHART_RANGE_ORDER, type ChartRange } from './chart-range.js';
import { ChartEmptyState } from './empty-state.js';
import { PeriodRangeDialog } from './period-range-dialog.js';
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
        aria-label="Chart actions"
      >
        <SymbolPickerDialog currentId={id} watched={symbols} onSelect={selectSymbol} />
        <PeriodRangeDialog
          period={period}
          range={range}
          watchedPeriods={selected.periods}
          onApply={applyPeriodRange}
        />
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
  const liveCandle = liveCandleForPeriod(useCandleStream(id), period);
  const lastLoaded = feed.candles.at(-1) ?? null;
  // The live bar is the freshest "latest"; when it opens a new bar the last
  // loaded one becomes the title's previous-close baseline.
  const latest = liveCandle ?? lastLoaded;
  const previous =
    liveCandle && lastLoaded && liveCandle.time > lastLoaded.time
      ? lastLoaded
      : (feed.candles.at(-2) ?? null);
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
      liveCandle={liveCandle}
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
