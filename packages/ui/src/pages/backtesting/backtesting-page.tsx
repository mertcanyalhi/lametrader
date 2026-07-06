import type { Config, EnrichedSymbol, Period } from '@lametrader/core';
import { Callout, Card, Flex, Heading, Text } from '@radix-ui/themes';
import { type ReactNode, useState } from 'react';
import { useWatchlist } from '../../lib/hooks/symbols.js';
import { useConfig } from '../../lib/hooks/use-config.js';
import { ChartLoading } from '../chart/chart-loading.js';
import type { ChartRange } from '../chart/chart-range.js';
import { PeriodRangeDialog } from '../chart/period-range-dialog.js';
import { ProfilePickerDialog } from '../chart/profile-picker-dialog.js';
import { SymbolPickerDialog } from '../chart/symbol-picker-dialog.js';

/**
 * The `/backtesting` route — the empty-but-navigable home for the backtesting
 * feature.
 *
 * This slice establishes the page, its split layout, and the selected-context
 * state (symbol / profile / period) that later slices (strategy management, run
 * form, results) bind to. There is no strategy management or run capability yet.
 *
 * Loads the enriched watchlist (for the symbol picker) and the config (for the
 * default period), then defers to {@link BacktestingLayout}. Unlike `/chart`,
 * bare `/backtesting` never redirects: an empty watchlist still renders the page
 * (with a hint), since the page is a destination in its own right.
 */
export function BacktestingPage(): ReactNode {
  const watchlist = useWatchlist();
  const config = useConfig();

  if (watchlist.isPending || config.isPending) return <ChartLoading />;
  if (watchlist.isError) return <ErrorCallout message={watchlist.error.message} />;
  if (config.isError) return <ErrorCallout message={config.error.message} />;

  return <BacktestingLayout symbols={watchlist.data ?? []} config={config.data} />;
}

/**
 * The page's split layout plus its selected-context state.
 *
 * The selected symbol and period live in local component state (profile lives in
 * the shared {@link ProfilePickerDialog} context); later slices read this
 * context to seed the run form and lock the pickers during a run. The symbol
 * defaults to the first watched symbol and the period to the config default.
 *
 * The `range` is tracked only to satisfy the reused {@link PeriodRangeDialog}'s
 * contract; the backtest range comes from the run form's start/end dates in a
 * later slice, so it does not drive anything here.
 */
function BacktestingLayout({
  symbols,
  config,
}: {
  symbols: EnrichedSymbol[];
  config: Config;
}): ReactNode {
  const [symbolId, setSymbolId] = useState<string | null>(() => symbols[0]?.id ?? null);
  const [period, setPeriod] = useState<Period>(config.defaultPeriod);
  const [range, setRange] = useState<ChartRange | null>(null);

  const selected = symbols.find((symbol) => symbol.id === symbolId) ?? null;
  const watchedPeriods = selected?.periods ?? [];

  return (
    <div className="grid h-full grid-rows-[minmax(0,1fr)_auto] gap-3">
      <div className="grid min-h-0 grid-cols-1 gap-3 lg:grid-cols-3">
        <section aria-label="Backtest chart" className="min-h-0 lg:col-span-2">
          <ChartPlaceholder />
        </section>
        <section aria-label="Backtest panel" className="min-h-0">
          <PanelPlaceholder />
        </section>
      </div>
      <Flex
        gap="2"
        align="center"
        className="border-t border-[var(--gray-a5)] pt-3"
        role="group"
        aria-label="Backtesting actions"
      >
        <ProfilePickerDialog />
        <SymbolPickerDialog currentId={symbolId ?? ''} watched={symbols} onSelect={setSymbolId} />
        <PeriodRangeDialog
          period={period}
          range={range}
          watchedPeriods={watchedPeriods}
          onApply={(next) => {
            setPeriod(next.period);
            setRange(next.range);
          }}
        />
      </Flex>
    </div>
  );
}

/**
 * The left ⅔ region: empty until a run exists. Later slices mount the reused
 * `CandleChart` here, filled incrementally from run frames.
 */
function ChartPlaceholder(): ReactNode {
  return (
    <Card className="h-full">
      <Flex direction="column" align="center" justify="center" gap="2" className="h-full" p="6">
        <Heading size="4">No backtest yet</Heading>
        <Text size="2" color="gray" align="center">
          Pick a symbol, profile, and period below, then run a backtest to see the chart.
        </Text>
      </Flex>
    </Card>
  );
}

/**
 * The right ⅓ region: placeholder sections for the run setup and results that
 * later slices fill (strategy selector + run form, then Summary / Trades /
 * Daily P&L tabs and the saved-backtests list).
 */
function PanelPlaceholder(): ReactNode {
  return (
    <Card className="h-full">
      <Flex direction="column" gap="4" p="2">
        <section aria-label="Backtest setup">
          <Heading size="3">Setup</Heading>
          <Text size="2" color="gray">
            Strategy selection and the run form land here.
          </Text>
        </section>
        <section aria-label="Backtest results">
          <Heading size="3">Results</Heading>
          <Text size="2" color="gray">
            Summary, trades, and daily P&amp;L appear here after a run.
          </Text>
        </section>
      </Flex>
    </Card>
  );
}

/** A red error callout for a failed watchlist / config load. */
function ErrorCallout({ message }: { message: string }): ReactNode {
  return (
    <Callout.Root color="red" role="alert">
      <Callout.Text>{message}</Callout.Text>
    </Callout.Root>
  );
}
