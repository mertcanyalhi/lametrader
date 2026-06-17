import type { EnrichedSymbol, Period, SymbolQuote } from '@lametrader/core';
import { Callout, Flex, Link as RadixLink } from '@radix-ui/themes';
import { type ReactNode, useEffect } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { formatChange, formatChangePct, formatPrice } from '../../lib/format.js';
import { usePagedCandles } from '../../lib/hooks/candles.js';
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
 * Layout (TradingView-style): the candle canvas fills the page, with a
 * top-left overlay carrying the symbol summary + the hovered candle's OHLC
 * legend; the bottom bar holds the symbol picker and the period+range dialog
 * triggers, leaving room for further actions in the future.
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
  if (!id || !period) {
    const first = symbols[0];
    if (!first || !cfg) return <Navigate to="/" replace />;
    const target = new URLSearchParams({ id: id ?? first.id, period: period ?? cfg.defaultPeriod });
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
    const params = new URLSearchParams({ id: id ?? '', period: next.period });
    if (next.range) params.set('range', next.range);
    setParams(params);
  }

  return (
    <div className="grid h-full grid-rows-[minmax(0,1fr)_auto] gap-3">
      <DocumentTitle symbol={selected} />
      <div className="min-h-0">
        {selected.periods.includes(period) ? (
          <ChartView id={id} period={period} range={range} symbol={selected} />
        ) : (
          <PeriodNotWatched period={period} />
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
 * Drives the document title to `<id> · <price> <change> (<pct>%) - lametrader`,
 * so the browser tab reflects the current chart. Restores the previous title
 * on unmount so navigating away doesn't leave a stale tab label.
 */
function DocumentTitle({ symbol }: { symbol: EnrichedSymbol }): ReactNode {
  useEffect(() => {
    const previous = document.title;
    document.title = `${symbol.id}${quoteTitlePart(symbol.quote)} - lametrader`;
    return () => {
      document.title = previous;
    };
  }, [symbol.id, symbol.quote]);
  return null;
}

/**
 * The price / change segment of the document title, prefixed with ` · ` when a
 * snapshot quote is available — otherwise empty so the title is just the id.
 */
function quoteTitlePart(quote: SymbolQuote | null): string {
  if (!quote) return '';
  return ` · ${formatPrice(quote.price)} ${formatChange(quote.change)} (${formatChangePct(quote.changePct)})`;
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
  if (feed.isPending) return <ChartLoading />;
  if (feed.isError)
    return <ErrorCallout message={feed.error?.message ?? 'Failed to load candles.'} />;
  if (feed.candles.length === 0) return <ChartEmptyState id={id} periods={symbol.periods} />;
  return (
    <CandleChart
      candles={feed.candles}
      symbol={symbol}
      period={period}
      range={range}
      loadOlder={feed.loadOlder}
      hasMore={feed.hasMore}
    />
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
