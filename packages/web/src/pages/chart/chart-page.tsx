import type { EnrichedSymbol, Period } from '@lametrader/core';
import { Callout, Flex, Link as RadixLink } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { usePagedCandles } from '../../lib/hooks/candles.js';
import { useWatchlist } from '../../lib/hooks/symbols.js';
import { useConfig } from '../../lib/hooks/use-config.js';
import { CandleChart } from './candle-chart.js';
import { ChartLoading } from './chart-loading.js';
import { ChartToolbar } from './chart-toolbar.js';
import { ChartEmptyState } from './empty-state.js';

/**
 * The `/chart` page: a URL-driven candlestick chart of one watched symbol on one
 * period (`/chart?id=&period=`). Reads the enriched watchlist (for the symbol
 * selector + snapshot header) and the config (for the default period). Bare
 * `/chart` redirects to the first watched symbol on `config.defaultPeriod`, or
 * to the watchlist when nothing is watched.
 */
export function ChartPage(): ReactNode {
  const [params] = useSearchParams();
  const watchlist = useWatchlist();
  const config = useConfig();

  if (watchlist.isPending || config.isPending) return <ChartLoading />;
  if (watchlist.isError) return <ErrorCallout message={watchlist.error.message} />;
  if (config.isError) return <ErrorCallout message={config.error.message} />;

  const symbols = watchlist.data ?? [];
  const cfg = config.data;
  const id = params.get('id');
  const period = params.get('period') as Period | null;

  // Bare /chart (or a missing half) → resolve a sensible default, or bounce home.
  if (!id || !period) {
    const first = symbols[0];
    if (!first || !cfg) return <Navigate to="/" replace />;
    const target = new URLSearchParams({ id: id ?? first.id, period: period ?? cfg.defaultPeriod });
    return <Navigate to={`/chart?${target}`} replace />;
  }

  const selected = symbols.find((symbol) => symbol.id === id);
  if (!selected) return <Navigate to="/" replace />;

  return (
    <Flex direction="column" gap="4">
      <ChartToolbar symbols={symbols} id={id} period={period} />
      {selected.periods.includes(period) ? (
        <ChartView id={id} period={period} symbol={selected} />
      ) : (
        <PeriodNotWatched period={period} />
      )}
    </Flex>
  );
}

/**
 * The chart body for a watched symbol/period: the windowed candle feed rendered
 * as a candlestick chart, with loading, error, and "no candles" states.
 */
function ChartView({
  id,
  period,
  symbol,
}: {
  id: string;
  period: Period;
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
      type={symbol.type}
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
