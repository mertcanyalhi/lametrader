import {
  type Backtest,
  BacktestStatus,
  type Candle,
  type Config,
  type EnrichedSymbol,
  type Period,
  periodMillis,
} from '@lametrader/core';
import {
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  Popover,
  Progress,
  Switch,
  Text,
} from '@radix-ui/themes';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SeriesMarker, Time } from 'lightweight-charts';
import { Settings } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { formingBucketCandle } from '../../lib/aggregate-candles.js';
import {
  getStoredBacktestPeriod,
  getStoredBacktestSymbolId,
  setStoredBacktestPeriod,
  setStoredBacktestSymbolId,
} from '../../lib/backtest-selection.js';
import { formatChange } from '../../lib/format.js';
import {
  COMPLETED_BACKTESTS_QUERY_KEY,
  useCancelBacktest,
  useRunningBacktest,
} from '../../lib/hooks/backtests.js';
import { fetchRangeCandles } from '../../lib/hooks/candles.js';
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
import type { StateOverlay } from '../chart/states/state-overlay.js';
import { SymbolPickerDialog } from '../chart/symbol-picker-dialog.js';
import { ResultsTabs } from './results-tabs.js';
import { RunForm } from './run-form.js';
import { stateOverlaysFromEvents } from './run-state-overlays.js';
import { PreviousRunsDialog } from './saved-backtests-list.js';
import { StrategyManager } from './strategy-manager.js';
import { buildTradeMarkers } from './trade-markers.js';

/** Scoped logger for run-cancel failures. */
const log = getLogger('backtesting-page');

/** Milliseconds in one day — turns a run's `elapsedDays` into a frontier time. */
const MS_PER_DAY = 86_400_000;

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
  // Seed the symbol from the last-used one (persisted), as long as it's still
  // watched; otherwise the first watched symbol. This survives the layout
  // re-mounting (a navigation, reload, or a run ending) instead of snapping back
  // to `symbols[0]`.
  const [symbolId, setSymbolId] = useState<string | null>(() => {
    const stored = getStoredBacktestSymbolId();
    return stored && symbols.some((symbol) => symbol.id === stored)
      ? stored
      : (symbols[0]?.id ?? null);
  });
  // Idle default: the last-used period (persisted) when it's watched on the
  // seeded symbol, else that symbol's smallest watched period (the finest
  // timeframe it holds), not the global config default. A reattach / load aligns
  // this to the run's own period (see the effects below), so this only seeds a
  // fresh selection. Picking another symbol re-seeds it in `selectSymbol`; the
  // config default is the fallback for an empty list.
  const [period, setPeriod] = useState<Period>(() => {
    const seededSymbol = symbols.find((symbol) => symbol.id === symbolId) ?? symbols[0] ?? null;
    const stored = getStoredBacktestPeriod();
    return stored && (seededSymbol?.periods.includes(stored) ?? false)
      ? stored
      : smallestPeriod(seededSymbol, config);
  });
  const [range, setRange] = useState<ChartRange | null>(null);
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<ActiveBacktest | null>(null);
  const [loaded, setLoaded] = useState<Backtest | null>(null);
  const [hydrated, setHydrated] = useState(false);
  // Rule-event overlays clutter the chart, so they stay hidden until the trader
  // opts in through the bottom-bar chart settings. Trade (Buy/Sell) markers, by
  // contrast, show by default. Lazy: session-scoped state — the ceiling is
  // "resets on reload"; a lib/* preference module would persist it if asked.
  const [showRuleEvents, setShowRuleEvents] = useState(false);
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
      setStrategyId(running.strategyId);
    }
    setHydrated(true);
  }, [hydrated, runningQuery.isPending, runningQuery.data]);

  // Persist the selection on every change (a symbol/period pick, a reattach, a
  // loaded backtest) so the seed above can restore it after a re-mount.
  useEffect(() => {
    if (symbolId) setStoredBacktestSymbolId(symbolId);
  }, [symbolId]);
  useEffect(() => {
    setStoredBacktestPeriod(period);
  }, [period]);

  const run = useBacktestRun(activeRun);
  const loadedView = useLoadedBacktest(loaded);
  // A run and a loaded backtest are mutually exclusive, so at most one view is
  // ever non-null; the live run takes precedence while it is active.
  const view = run ?? loadedView;
  const { theme } = useTheme();
  const locked = activeRun !== null || loaded !== null;
  // The picker's `period` drives the chart, always. A run/loaded view feeds its
  // live/replayed candles only while the picker sits on the run's own period.
  // Switch the picker elsewhere and the chart shows that period's stored candles
  // over the SAME replay window (a run produces data at one period only) — see
  // `OffPeriodBacktestChart`. This keeps the picker live during a run and leaves
  // nothing to snap back when the run ends.
  const onRunPeriod = view !== null && period === view.params.period;
  // The replay frontier: how far the run has advanced through its window. A live
  // run reports `elapsedDays`; a loaded (completed) view reports it fully elapsed,
  // so this is its `end`. Bounds the off-period chart so it never reveals bars
  // past the cursor.
  const frontier = view
    ? Math.min(view.params.end, view.params.start + view.progress.elapsedDays * MS_PER_DAY)
    : 0;

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

  // Picking a new symbol re-seeds the idle period to that symbol's smallest
  // watched period. Done in the handler (not a `symbolId` effect) so it never
  // clobbers the period the reattach effect / `loadBacktest` set alongside
  // their own symbol change.
  function selectSymbol(id: string): void {
    setSymbolId(id);
    setPeriod(smallestPeriod(symbols.find((symbol) => symbol.id === id) ?? null, config));
  }

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
      {run ? <BacktestDocumentTitle run={run} /> : null}
      <div className="grid min-h-0 grid-cols-1 gap-3 lg:grid-cols-3 lg:grid-rows-1">
        <section aria-label="Backtest chart" className="min-h-0 lg:col-span-2">
          {view && selected && onRunPeriod ? (
            <Card className="h-full">
              <CandleChart
                candles={view.chartCandles}
                symbol={selected}
                period={period}
                range={null}
                loadOlder={noop}
                hasMore={false}
                follow
                live={false}
                eventMarkers={tradeMarkers}
                stateOverlays={showRuleEvents ? runStateOverlays : []}
              />
            </Card>
          ) : view && selected ? (
            <OffPeriodBacktestChart
              symbol={selected}
              period={period}
              start={view.params.start}
              end={view.params.end}
              frontier={frontier}
              runPeriod={view.params.period}
              runCandles={view.chartCandles}
              eventMarkers={tradeMarkers}
              stateOverlays={showRuleEvents ? runStateOverlays : []}
            />
          ) : (
            <ChartPlaceholder />
          )}
        </section>
        <section aria-label="Backtest panel" className="min-h-0">
          <BacktestPanel
            symbolId={symbolId ?? ''}
            profileId={profileId}
            period={period}
            strategyId={strategyId}
            onStrategyIdChange={setStrategyId}
            view={view}
            runId={activeRun?.id ?? null}
            loaded={loaded}
            locked={locked}
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
          onSelect={selectSymbol}
          disabled={locked}
        />
        <PeriodRangeDialog
          period={period}
          range={range}
          watchedPeriods={watchedPeriods}
          onApply={(next) => {
            setPeriod(next.period);
            setRange(next.range);
          }}
        />
        <PreviousRunsDialog onLoad={loadBacktest} disabled={locked} />
        <ChartSettings showRuleEvents={showRuleEvents} onShowRuleEventsChange={setShowRuleEvents} />
      </Flex>
    </div>
  );
}

/**
 * The smallest (finest) period a symbol is watched on — the min by
 * {@link periodMillis} of its `periods`. Falls back to the global
 * `config.defaultPeriod` when the symbol is missing or has no watched periods,
 * so a symbol with an empty list still yields a usable default.
 *
 * @param symbol - the selected symbol, or `null` when none is selected.
 * @param config - the app config supplying the fallback period.
 */
function smallestPeriod(symbol: EnrichedSymbol | null, config: Config): Period {
  const periods = symbol?.periods ?? [];
  if (periods.length === 0) return config.defaultPeriod;
  return periods.reduce((min, period) => (periodMillis(period) < periodMillis(min) ? period : min));
}

/** No-op passed to the reused chart's paging hook — a backtest never scrolls back. */
function noop(): void {}

/**
 * The backtest chart at a period **other** than the run's own. A run produces
 * data at a single period, so switching the picker mid-run (or on a loaded run)
 * can't reuse the run's frames; instead this reads that period's stored candles
 * over the run's own window from the candle store (the same {@link fetchRangeCandles}
 * the reattach/load paths use). The run's trade markers / state overlays are kept
 * on top, and `follow` keeps the frontier bar in view.
 *
 * Two things keep it aligned to the replay cursor rather than leaking future data:
 * - **Completed buckets only.** A stored bar shows only once its whole bucket lies
 *   at/behind the frontier (clip on bucket *end*, `time + periodMillis(period)`),
 *   so a bar the replay is only partway through never appears with its full,
 *   not-yet-reached OHLC.
 * - **A synthesized forming bar.** When the run's own period is *finer* than the
 *   picked one, the current bucket is folded live from the run's finer replay
 *   candles up to the frontier via {@link formingBucketCandle} — the same way the
 *   run chart forms its bar — so the in-progress bucket grows with the replay
 *   instead of popping in whole. When the run's period is coarser (no finer replay
 *   data to fold), there is no forming bar and only completed buckets show.
 *
 * The fetch is keyed by the fixed run window (`symbol`, `period`, `start`, `end`),
 * not the moving frontier, so a live run advancing the frontier re-clips an
 * already-fetched series rather than refetching the whole window each frame.
 *
 * @param symbol - the charted symbol.
 * @param period - the picked period to chart (≠ the run's period).
 * @param start - the run window's start (inclusive), epoch ms.
 * @param end - the run window's end (exclusive), epoch ms.
 * @param frontier - the replay frontier; bars past it are hidden.
 * @param runPeriod - the run's own period; its finer candles form the current bar.
 * @param runCandles - the run's candles at `runPeriod`, used to fold the forming bar.
 * @param eventMarkers - the run's trade markers to overlay.
 * @param stateOverlays - the run's state overlays to overlay (empty when gated off).
 */
function OffPeriodBacktestChart({
  symbol,
  period,
  start,
  end,
  frontier,
  runPeriod,
  runCandles,
  eventMarkers,
  stateOverlays,
}: {
  symbol: EnrichedSymbol;
  period: Period;
  start: number;
  end: number;
  frontier: number;
  runPeriod: Period;
  runCandles: readonly Candle[];
  eventMarkers: ReadonlyArray<SeriesMarker<Time>>;
  stateOverlays: ReadonlyArray<StateOverlay>;
}): ReactNode {
  const query = useQuery({
    queryKey: ['backtest-offperiod-candles', symbol.id, period, start, end],
    queryFn: () => fetchRangeCandles(symbol.id, period, start, end),
  });
  const candles = useMemo(() => {
    const periodMs = periodMillis(period);
    // Completed buckets only: the whole bucket must lie at/behind the frontier,
    // so no bar shows OHLC from time the replay hasn't reached.
    const completed = (query.data ?? []).filter((c) => c.time + periodMs <= frontier);
    // Fold the current (forming) bucket from the run's finer replay candles up to
    // the frontier — only when the run's own period is finer than the picked one.
    if (periodMillis(runPeriod) < periodMs) {
      const bucketStart = Math.floor(frontier / periodMs) * periodMs;
      const finer = runCandles
        .filter((c) => c.time >= bucketStart && c.time <= frontier)
        .sort((a, b) => a.time - b.time);
      const forming = formingBucketCandle(finer, period);
      if (forming) return [...completed, forming];
    }
    return completed;
  }, [query.data, frontier, period, runPeriod, runCandles]);
  return (
    <Card className="h-full">
      <CandleChart
        candles={candles}
        symbol={symbol}
        period={period}
        range={null}
        loadOlder={noop}
        hasMore={false}
        follow
        live={false}
        eventMarkers={eventMarkers}
        stateOverlays={stateOverlays}
      />
    </Card>
  );
}

/**
 * The bottom bar's chart-settings control: a text {@link Button} (cog icon +
 * "Chart settings") opening a {@link Popover} of per-chart display toggles.
 *
 * For now the only knob is "Show rule events", which gates the run's recorded
 * rule-event overlays on the backtesting chart (default off). Trade (Buy/Sell)
 * markers are not gated here — they show by default. Living in the bottom bar
 * (rather than floating over the chart) keeps the control clear of the chart's
 * right-hand price scale.
 */
function ChartSettings({
  showRuleEvents,
  onShowRuleEventsChange,
}: {
  showRuleEvents: boolean;
  onShowRuleEventsChange: (next: boolean) => void;
}): ReactNode {
  return (
    <Popover.Root>
      <Popover.Trigger>
        <Button type="button" variant="soft" color="gray" ml="auto">
          <Settings size={16} />
          Chart settings
        </Button>
      </Popover.Trigger>
      <Popover.Content size="1">
        <Text as="label" size="2">
          <Flex align="center" gap="2">
            <Switch checked={showRuleEvents} onCheckedChange={onShowRuleEventsChange} />
            Show rule events
          </Flex>
        </Text>
      </Popover.Content>
    </Popover.Root>
  );
}

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
  locked,
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
  /** A run is active (or a saved backtest is loaded); strategy actions lock. */
  locked: boolean;
  onStarted: (backtestId: string) => void;
  onDismiss: () => void;
  onCloseLoaded: () => void;
}): ReactNode {
  if (loaded !== null) {
    return (
      <Card className="h-full">
        <Flex direction="column" gap="4" p="2" className="h-full overflow-y-auto">
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
      <Flex direction="column" gap="4" p="2" className="h-full overflow-y-auto">
        <section aria-label="Backtest setup">
          <StrategyManager
            symbolId={symbolId}
            selectedId={strategyId}
            onSelectedIdChange={onStrategyIdChange}
            disabled={locked}
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

/**
 * Drives the document title to `<symbol> <pct>% <total P/L> - lametrader` while a
 * backtest is active, so the browser tab tracks a run's progress and running P/L
 * from another tab. The percentage is the run's elapsed-days progress while it
 * streams and a full `100%` once it completes (until dismissed); the P/L is the
 * running Σ over closed trades so far. Mounted only while a run is active, so
 * dismissing it (or leaving the page) restores the pre-run title.
 */
function BacktestDocumentTitle({ run }: { run: BacktestRunView }): ReactNode {
  const percent = run.status === BacktestStatus.Completed ? 100 : progressPercent(run);
  const title = `${run.params.symbolId} ${percent}% ${formatChange(run.summary.totalPnl)} - lametrader`;
  // Capture the pre-run title once (mount) and restore it on unmount — the run
  // component unmounts in place when the run is dismissed, so restoring the last
  // title instead would leave the tab stuck on a finished run's line.
  useEffect(() => {
    const previous = document.title;
    return () => {
      document.title = previous;
    };
  }, []);
  useEffect(() => {
    document.title = title;
  }, [title]);
  return null;
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
