import {
  type Backtest,
  BacktestStatus,
  type Config,
  type EnrichedSymbol,
  type Period,
} from '@lametrader/core';
import { Button, Callout, Card, Flex, Heading, Progress, Text } from '@radix-ui/themes';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  COMPLETED_BACKTESTS_QUERY_KEY,
  useCancelBacktest,
  useRunningBacktest,
} from '../../lib/hooks/backtests.js';
import { useWatchlist } from '../../lib/hooks/symbols.js';
import {
  type ActiveBacktest,
  type BacktestRunView,
  useBacktestRun,
} from '../../lib/hooks/use-backtest-run.js';
import { useConfig } from '../../lib/hooks/use-config.js';
import { useLoadedBacktest } from '../../lib/hooks/use-loaded-backtest.js';
import { getLogger } from '../../lib/log.js';
import { useSelectedProfile } from '../../lib/selected-profile-context.js';
import { useTheme } from '../../lib/theme-context.js';
import { CandleChart } from '../chart/candle-chart.js';
import { ChartLoading } from '../chart/chart-loading.js';
import type { ChartRange } from '../chart/chart-range.js';
import { PeriodRangeDialog } from '../chart/period-range-dialog.js';
import { ProfilePickerDialog } from '../chart/profile-picker-dialog.js';
import { SymbolPickerDialog } from '../chart/symbol-picker-dialog.js';
import { ResultsTabs } from './results-tabs.js';
import { RunForm } from './run-form.js';
import { stateOverlaysFromEvents } from './run-state-overlays.js';
import { PreviousRunsDialog } from './saved-backtests-list.js';
import { StrategyManager } from './strategy-manager.js';
import { buildTradeMarkers } from './trade-markers.js';

/** Scoped logger for run-cancel failures. */
const log = getLogger('backtesting-page');

/**
 * The `/backtesting` route — define a strategy, run it against a symbol's stored
 * history, and watch the run fill the chart live (spec: *UI — run flow*).
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
 * The page's split layout plus its selected-context and run state.
 *
 * The layout owns the run lifecycle: {@link useBacktestRun} streams the active
 * run's frames, the pickers lock while a run is active, and the chart fills from
 * the run's incremental candles. On first load it reattaches to any run already
 * in flight (surviving a navigation away): the running-backtest discovery query
 * seeds `activeRun` once, and the stream's snapshot restores progress + results
 * while REST catches the chart up.
 */
function BacktestingLayout({
  symbols,
  config,
}: {
  symbols: EnrichedSymbol[];
  config: Config;
}): ReactNode {
  const { profileId } = useSelectedProfile();
  const [symbolId, setSymbolId] = useState<string | null>(() => symbols[0]?.id ?? null);
  const [period, setPeriod] = useState<Period>(config.defaultPeriod);
  const [range, setRange] = useState<ChartRange | null>(null);
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<ActiveBacktest | null>(null);
  const [loaded, setLoaded] = useState<Backtest | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const queryClient = useQueryClient();

  const runningQuery = useRunningBacktest();
  // Reattach once on first load: the single running run (if any) is the active
  // one; align the locked pickers to its symbol / period.
  useEffect(() => {
    if (hydrated || runningQuery.isPending) return;
    const running = runningQuery.data?.[0];
    if (running) {
      setActiveRun({ id: running.id, reattach: true });
      setSymbolId(running.params.symbolId);
      setPeriod(running.params.period);
    }
    setHydrated(true);
  }, [hydrated, runningQuery.isPending, runningQuery.data]);

  const run = useBacktestRun(activeRun);
  const loadedView = useLoadedBacktest(loaded);
  // A run and a loaded backtest are mutually exclusive, so at most one view is
  // ever non-null; the live run takes precedence while it is active.
  const view = run ?? loadedView;
  const { theme } = useTheme();
  const locked = activeRun !== null || loaded !== null;
  const chartPeriod = view?.params.period ?? period;

  // When a run finishes, refresh the saved-backtests list so the just-persisted
  // backtest is there once the page returns to idle.
  const runCompleted = run?.status === BacktestStatus.Completed;
  useEffect(() => {
    if (runCompleted) {
      queryClient.invalidateQueries({ queryKey: COMPLETED_BACKTESTS_QUERY_KEY });
    }
  }, [runCompleted, queryClient]);

  // Reload a saved backtest into the finished-run view without starting a run:
  // align the (now locked) pickers to its stored symbol / period.
  function loadBacktest(backtest: Backtest): void {
    setActiveRun(null);
    setLoaded(backtest);
    setSymbolId(backtest.params.symbolId);
    setPeriod(backtest.params.period);
  }

  const selected = symbols.find((symbol) => symbol.id === symbolId) ?? null;
  const watchedPeriods = selected?.periods ?? [];

  // The view's trades draw entry/exit markers and its events drive the chart's
  // state overlays — sourced from the run frames while live, or the persisted
  // document plus its windowed events once a saved backtest is loaded.
  const tradeMarkers = useMemo(
    () => (view ? buildTradeMarkers(view.trades, view.openPosition) : []),
    [view],
  );
  const runStateOverlays = useMemo(
    () => (view ? stateOverlaysFromEvents(view.events, theme) : []),
    [view, theme],
  );

  return (
    <div className="grid h-full grid-rows-[minmax(0,1fr)_auto] gap-3">
      <div className="grid min-h-0 grid-cols-1 gap-3 lg:grid-cols-3">
        <section aria-label="Backtest chart" className="min-h-0 lg:col-span-2">
          {view && selected ? (
            <Card className="h-full">
              <CandleChart
                candles={view.chartCandles}
                symbol={selected}
                period={chartPeriod}
                range={null}
                loadOlder={noop}
                hasMore={false}
                follow
                eventMarkers={tradeMarkers}
                stateOverlays={runStateOverlays}
              />
            </Card>
          ) : (
            <ChartPlaceholder />
          )}
        </section>
        <section aria-label="Backtest panel" className="min-h-0">
          <BacktestPanel
            symbolId={symbolId ?? ''}
            profileId={profileId}
            period={chartPeriod}
            strategyId={strategyId}
            onStrategyIdChange={setStrategyId}
            view={view}
            runId={activeRun?.id ?? null}
            loaded={loaded}
            onStarted={(id) => {
              setLoaded(null);
              setActiveRun({ id, reattach: false });
            }}
            onDismiss={() => setActiveRun(null)}
            onCloseLoaded={() => setLoaded(null)}
          />
        </section>
      </div>
      <Flex
        gap="2"
        align="center"
        className="border-t border-[var(--gray-a5)] pt-3"
        role="group"
        aria-label="Backtesting actions"
      >
        <ProfilePickerDialog disabled={locked} />
        <SymbolPickerDialog
          currentId={symbolId ?? ''}
          watched={symbols}
          onSelect={setSymbolId}
          disabled={locked}
        />
        <PeriodRangeDialog
          period={period}
          range={range}
          watchedPeriods={watchedPeriods}
          disabled={locked}
          onApply={(next) => {
            setPeriod(next.period);
            setRange(next.range);
          }}
        />
        <PreviousRunsDialog onLoad={loadBacktest} disabled={locked} />
      </Flex>
    </div>
  );
}

/** No-op passed to the reused chart's paging hook — a backtest never scrolls back. */
function noop(): void {}

/**
 * The right ⅓ region across the page's three states: **loaded** (a saved
 * backtest's finished-run view with a Close control), **running** (progress +
 * cancel over the results), and **idle** (the strategy manager and the run
 * form). The saved-backtests list now lives in the bottom bar's "Previous runs"
 * modal ({@link PreviousRunsDialog}), not inline here.
 *
 * The results tabs (Summary / Trades / Daily P&L) render from the unified `view`
 * — the live run while it streams, or the reloaded backtest once one is loaded.
 */
function BacktestPanel({
  symbolId,
  profileId,
  period,
  strategyId,
  onStrategyIdChange,
  view,
  runId,
  loaded,
  onStarted,
  onDismiss,
  onCloseLoaded,
}: {
  symbolId: string;
  profileId: string | null;
  period: Period;
  strategyId: string | null;
  onStrategyIdChange: (id: string | null) => void;
  view: BacktestRunView | null;
  runId: string | null;
  loaded: Backtest | null;
  onStarted: (backtestId: string) => void;
  onDismiss: () => void;
  onCloseLoaded: () => void;
}): ReactNode {
  if (loaded !== null) {
    return (
      <Card className="h-full">
        <Flex direction="column" gap="4" p="2">
          <section aria-label="Loaded backtest">
            <Flex justify="between" align="center" gap="2" mb="1">
              <Heading size="3" className="truncate">
                {loaded.name}
              </Heading>
              <Button type="button" variant="soft" color="gray" onClick={onCloseLoaded}>
                Close
              </Button>
            </Flex>
            <Text size="1" color="gray">
              Saved backtest
            </Text>
          </section>
          {view ? <ResultsSection view={view} /> : null}
        </Flex>
      </Card>
    );
  }

  const idle = runId === null;
  return (
    <Card className="h-full">
      <Flex direction="column" gap="4" p="2">
        <section aria-label="Backtest setup">
          <StrategyManager
            symbolId={symbolId}
            selectedId={strategyId}
            onSelectedIdChange={onStrategyIdChange}
          />
        </section>
        <section aria-label="Backtest run">
          {idle ? (
            <RunForm
              strategyId={strategyId}
              symbolId={symbolId}
              profileId={profileId}
              period={period}
              onStarted={onStarted}
            />
          ) : (
            <RunProgress run={view} runId={runId} onDismiss={onDismiss} />
          )}
        </section>
        {view ? <ResultsSection view={view} /> : null}
      </Flex>
    </Card>
  );
}

/** The Summary / Trades / Daily P&L tabs over the unified run view. */
function ResultsSection({ view }: { view: BacktestRunView }): ReactNode {
  return (
    <section aria-label="Backtest results">
      <Heading size="3" mb="2">
        Results
      </Heading>
      <ResultsTabs trades={view.trades} summary={view.summary} openPosition={view.openPosition} />
    </section>
  );
}

/** Clamp a run's elapsed-days / total-days progress to a whole 0–100 percentage. */
function progressPercent(run: BacktestRunView | null): number {
  if (!run || run.progress.totalDays <= 0) return 0;
  const pct = (run.progress.elapsedDays / run.progress.totalDays) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/**
 * The active-run view: a progress bar plus Cancel (while running) or New run
 * (once completed). Cancelling discards the run and returns the page to idle.
 */
function RunProgress({
  run,
  runId,
  onDismiss,
}: {
  run: BacktestRunView | null;
  runId: string | null;
  onDismiss: () => void;
}): ReactNode {
  const cancel = useCancelBacktest();
  const completed = run?.status === BacktestStatus.Completed;
  const percent = completed ? 100 : progressPercent(run);

  async function handleCancel(): Promise<void> {
    if (runId !== null) {
      try {
        await cancel.mutateAsync(runId);
      } catch (error) {
        log.warn({ err: error }, 'failed to cancel backtest');
      }
    }
    onDismiss();
  }

  return (
    <Flex direction="column" gap="3" aria-label="Backtest progress">
      <Progress value={percent} aria-label="Run progress" />
      <Text size="2" color="gray">
        {completed ? 'Run complete' : run ? `Running — ${percent}%` : 'Starting run…'}
      </Text>
      {completed ? (
        <Button type="button" onClick={onDismiss}>
          New run
        </Button>
      ) : (
        <Button
          type="button"
          color="red"
          variant="soft"
          loading={cancel.isPending}
          onClick={() => void handleCancel()}
        >
          Cancel run
        </Button>
      )}
    </Flex>
  );
}

/**
 * The empty chart region shown before any run: a hint to pick a context and run.
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

/** A red error callout for a failed watchlist / config load. */
function ErrorCallout({ message }: { message: string }): ReactNode {
  return (
    <Callout.Root color="red" role="alert">
      <Callout.Text>{message}</Callout.Text>
    </Callout.Root>
  );
}
