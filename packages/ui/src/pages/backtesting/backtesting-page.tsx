import {
  type Backtest,
  type BacktestSignal,
  BacktestStatus,
  type BacktestStrategy,
  type BacktestThreshold,
  BacktestThresholdKind,
  type Config,
  type EnrichedSymbol,
  type Period,
  periodMillis,
} from '@lametrader/core';
import {
  Button,
  Callout,
  Card,
  DataList,
  Dialog,
  Flex,
  Heading,
  IconButton,
  Popover,
  Progress,
  Switch,
  Text,
  Tooltip,
  VisuallyHidden,
} from '@radix-ui/themes';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SeriesMarker, Time } from 'lightweight-charts';
import { Eye, Settings } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { formingBucketCandle } from '../../lib/aggregate-candles.js';
import type { RangeBounds } from '../../lib/backtest-range.js';
import {
  getStoredBacktestPeriod,
  getStoredBacktestStrategyId,
  getStoredBacktestSymbolId,
  getStoredBacktestWindow,
  setStoredBacktestPeriod,
  setStoredBacktestStrategyId,
  setStoredBacktestSymbolId,
  setStoredBacktestWindow,
} from '../../lib/backtest-selection.js';
import { formatChange, formatPrice } from '../../lib/format.js';
import { useBacktestStrategies } from '../../lib/hooks/backtest-strategies.js';
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
import { type LoadedBacktestView, useLoadedBacktest } from '../../lib/hooks/use-loaded-backtest.js';
import { getLogger } from '../../lib/log.js';
import { finestFinerPeriod } from '../../lib/periods.js';
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

/** Format an epoch-ms instant as a UTC `YYYY-MM-DD` calendar date (window bounds). */
function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Format an epoch-ms instant as UTC `YYYY-MM-DD HH:mm` (minute precision reads cleanly). */
function utcMinute(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

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
 * The layout owns the run lifecycle: {@link useBacktestRun} polls the active
 * run's progress and the pickers lock while a run is active. A live run is
 * progress-only — the chart and result tabs render from the loaded (completed)
 * path, so during a run they stay empty and a finished run flips into the loaded
 * view (see the completion effect below). On first load it reattaches to any run
 * already in flight (surviving a navigation away): the running-backtest discovery
 * query seeds `activeRun` once, and polling resumes from the run's current
 * progress.
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
  // The run form's date window, lifted here so it survives the form unmounting
  // while a run streams (the panel swaps it for the progress view) and isn't
  // reset when the run ends. Seeded from the last-used window (persisted), else
  // a trailing 90 days.
  const [runWindow, setRunWindow] = useState<RangeBounds>(() => {
    const stored = getStoredBacktestWindow();
    if (stored) return stored;
    const now = Date.now();
    return { from: now - 90 * MS_PER_DAY, to: now };
  });
  // Seeded from the last-used strategy (persisted), then validated against the
  // live list below — a persisted strategy may have been deleted since.
  const [strategyId, setStrategyId] = useState<string | null>(getStoredBacktestStrategyId);
  const [activeRun, setActiveRun] = useState<ActiveBacktest | null>(null);
  // The active run's document (from the start response or the reattach discovery),
  // used to show its metadata (strategy, window, run time) alongside the progress.
  // Its params/strategy/createdAt are immutable, so it never needs refetching.
  const [activeBacktest, setActiveBacktest] = useState<Backtest | null>(null);
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
      setActiveRun({ id: running.id });
      setActiveBacktest(running);
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
  useEffect(() => {
    setStoredBacktestWindow(runWindow);
  }, [runWindow]);
  useEffect(() => {
    setStoredBacktestStrategyId(strategyId);
  }, [strategyId]);

  // Drop the selected strategy once the live list confirms it's gone (deleted
  // here or elsewhere since it was persisted); leave it untouched while the list
  // is still loading so a valid seed isn't cleared on a transient empty list.
  const strategiesQuery = useBacktestStrategies();
  useEffect(() => {
    const strategies = strategiesQuery.data;
    if (!strategies || strategyId === null) return;
    if (!strategies.some((strategy) => strategy.id === strategyId)) {
      setStrategyId(null);
    }
  }, [strategiesQuery.data, strategyId]);

  const run = useBacktestRun(activeRun);
  const loadedView = useLoadedBacktest(loaded);
  // The chart + result tabs render only from the loaded (completed) path. A live
  // run is progress-only (`loadedView` is null while it polls), so `view` is null
  // during a run — the chart shows its placeholder and no results render — and a
  // finished run flips into the loaded view (see the completion effect below).
  const view: LoadedBacktestView | null = loadedView;
  const { theme } = useTheme();
  const locked = activeRun !== null || loaded !== null;
  // The picker's `period` drives the chart, always. A loaded view feeds its
  // replayed candles only while the picker sits on the run's own period. Switch
  // the picker elsewhere and the chart shows that period's stored candles over
  // the SAME window (a run produces data at one period only) — see
  // `OffPeriodBacktestChart`.
  const onRunPeriod = view !== null && period === view.params.period;
  // The replay frontier: how far the run advanced through its window. A loaded
  // (completed) view reports it fully elapsed, so this is its `end`, and the
  // off-period chart renders the whole window.
  const frontier = view
    ? Math.min(view.params.end, view.params.start + view.progress.elapsedDays * MS_PER_DAY)
    : 0;

  // A finished run flips into the loaded (completed) view: hand the polled
  // document to the loaded-backtest path, clear the active run, and refresh the
  // saved-backtests list so the just-persisted backtest is there. The page then
  // renders the finished run through the normal LoadedRunPanel, whose Close
  // control returns to idle.
  useEffect(() => {
    if (run?.status !== BacktestStatus.Completed) return;
    setLoaded(run.backtest);
    setActiveRun(null);
    setActiveBacktest(null);
    queryClient.invalidateQueries({ queryKey: COMPLETED_BACKTESTS_QUERY_KEY });
  }, [run?.status, run?.backtest, queryClient]);

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
            runWindow={runWindow}
            onRunWindowChange={setRunWindow}
            strategyId={strategyId}
            onStrategyIdChange={setStrategyId}
            run={run}
            view={view}
            runId={activeRun?.id ?? null}
            activeBacktest={activeBacktest}
            loaded={loaded}
            locked={locked}
            onStarted={(backtest) => {
              setLoaded(null);
              setActiveBacktest(backtest);
              setActiveRun({ id: backtest.id });
            }}
            onDismiss={() => {
              setActiveRun(null);
              setActiveBacktest(null);
            }}
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
        {/* Stays selectable while a saved run is displayed (only a live run
            locks it), so the trader can swap to another previous run directly. */}
        <PreviousRunsDialog onLoad={loadBacktest} disabled={activeRun !== null} />
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
 * - **A synthesized forming bar.** The current bucket is folded from the symbol's
 *   finest watched period *finer* than the picked one — its stored candles over
 *   the current bucket, clipped to the frontier, aggregated via
 *   {@link formingBucketCandle}. Reading the finer period from the store (rather
 *   than the run's own candles) means this works whether the run is finer *or*
 *   coarser than the view; only when the picked period is itself the symbol's
 *   finest (nothing finer to fold) is there no forming bar.
 *
 * The completed fetch is keyed by the fixed run window (`symbol`, `period`,
 * `start`, `end`); the forming fetch by the current bucket (`bucketStart`), so a
 * live run advancing the frontier re-clips already-fetched series and only
 * refetches the finer window when it crosses into a new bucket.
 *
 * @param symbol - the charted symbol.
 * @param period - the picked period to chart (≠ the run's period).
 * @param start - the run window's start (inclusive), epoch ms.
 * @param end - the run window's end (exclusive), epoch ms.
 * @param frontier - the replay frontier; bars past it are hidden.
 * @param eventMarkers - the run's trade markers to overlay.
 * @param stateOverlays - the run's state overlays to overlay (empty when gated off).
 */
function OffPeriodBacktestChart({
  symbol,
  period,
  start,
  end,
  frontier,
  eventMarkers,
  stateOverlays,
}: {
  symbol: EnrichedSymbol;
  period: Period;
  start: number;
  end: number;
  frontier: number;
  eventMarkers: ReadonlyArray<SeriesMarker<Time>>;
  stateOverlays: ReadonlyArray<StateOverlay>;
}): ReactNode {
  const periodMs = periodMillis(period);
  const bucketStart = Math.floor(frontier / periodMs) * periodMs;
  // The finest watched period below the picked one — its stored candles fold into
  // the current bucket's forming bar. `null` when the picked period is the finest.
  const finerPeriod = finestFinerPeriod(symbol.periods, period);

  const completedQuery = useQuery({
    queryKey: ['backtest-offperiod-candles', symbol.id, period, start, end],
    queryFn: () => fetchRangeCandles(symbol.id, period, start, end),
  });
  // Finer candles for just the current bucket, to fold its forming bar. Keyed by
  // `bucketStart`, so it refetches only when the frontier crosses a bucket edge.
  const formingQuery = useQuery({
    queryKey: ['backtest-offperiod-forming', symbol.id, finerPeriod, bucketStart, periodMs],
    queryFn: () =>
      finerPeriod === null
        ? []
        : fetchRangeCandles(symbol.id, finerPeriod, bucketStart, bucketStart + periodMs),
    enabled: finerPeriod !== null,
  });

  const candles = useMemo(() => {
    // Completed buckets only: the whole bucket must lie at/behind the frontier,
    // so no bar shows OHLC from time the replay hasn't reached.
    const completed = (completedQuery.data ?? []).filter((c) => c.time + periodMs <= frontier);
    // Fold the current bucket from the finer period's stored candles up to the
    // frontier (clip so the forming bar never reveals a not-yet-reached tick).
    const finer = (formingQuery.data ?? [])
      .filter((c) => c.time <= frontier)
      .sort((a, b) => a.time - b.time);
    const forming = formingBucketCandle(finer, period);
    return forming ? [...completed, forming] : completed;
  }, [completedQuery.data, formingQuery.data, frontier, period, periodMs]);
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
 * The loaded (saved) run's right-panel view: a "Previous run" header, the run's
 * metadata ({@link RunMetaList}), and its results.
 */
function LoadedRunPanel({
  loaded,
  view,
  onClose,
}: {
  loaded: Backtest;
  view: LoadedBacktestView | null;
  onClose: () => void;
}): ReactNode {
  return (
    <Card className="h-full">
      <Flex direction="column" gap="4" p="2" className="h-full overflow-y-auto">
        <section aria-label="Loaded backtest">
          <Flex justify="between" align="center" gap="2" mb="3">
            <Heading size="3">Previous run</Heading>
            <Button type="button" variant="soft" color="gray" onClick={onClose}>
              Close
            </Button>
          </Flex>
          <RunMetaList backtest={loaded} />
        </section>
        {view ? <ResultsSection view={view} /> : null}
      </Flex>
    </Card>
  );
}

/**
 * A run's metadata as a {@link DataList} — name, strategy (with a view control
 * opening its config), the replayed window, and when it ran. Shared by the
 * loaded-run view and the live-run panel, so both read identically. Owns the
 * strategy-config modal's open state.
 */
function RunMetaList({ backtest }: { backtest: Backtest }): ReactNode {
  const [showStrategy, setShowStrategy] = useState(false);
  return (
    <>
      <DataList.Root size="1">
        <DataList.Item>
          <DataList.Label>Name</DataList.Label>
          <DataList.Value>{backtest.name}</DataList.Value>
        </DataList.Item>
        <DataList.Item>
          <DataList.Label>Strategy</DataList.Label>
          <DataList.Value>
            <Flex align="center" gap="2">
              {backtest.strategy.name}
              <Tooltip content="View strategy">
                <IconButton
                  type="button"
                  size="1"
                  variant="ghost"
                  color="gray"
                  aria-label="View strategy"
                  onClick={() => setShowStrategy(true)}
                >
                  <Eye size={14} aria-hidden="true" />
                </IconButton>
              </Tooltip>
            </Flex>
          </DataList.Value>
        </DataList.Item>
        <DataList.Item>
          <DataList.Label>Start date</DataList.Label>
          <DataList.Value>{utcDate(backtest.params.start)}</DataList.Value>
        </DataList.Item>
        <DataList.Item>
          <DataList.Label>End date</DataList.Label>
          <DataList.Value>{utcDate(backtest.params.end)}</DataList.Value>
        </DataList.Item>
        <DataList.Item>
          <DataList.Label>Capital</DataList.Label>
          <DataList.Value>{formatPrice(backtest.params.initialCapital)}</DataList.Value>
        </DataList.Item>
        <DataList.Item>
          <DataList.Label>Ran at</DataList.Label>
          <DataList.Value>{utcMinute(backtest.createdAt)}</DataList.Value>
        </DataList.Item>
      </DataList.Root>
      <StrategyViewDialog
        strategy={backtest.strategy}
        open={showStrategy}
        onOpenChange={setShowStrategy}
      />
    </>
  );
}

/**
 * A read-only modal of a saved run's strategy snapshot — name, description, and
 * each configured entry / exit mechanism, rendered as a {@link DataList}.
 */
function StrategyViewDialog({
  strategy,
  open,
  onOpenChange,
}: {
  strategy: BacktestStrategy;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactNode {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>{strategy.name}</Dialog.Title>
        {strategy.description ? (
          <Dialog.Description size="2" color="gray" mb="3">
            {strategy.description}
          </Dialog.Description>
        ) : (
          <VisuallyHidden>
            <Dialog.Description>Strategy configuration.</Dialog.Description>
          </VisuallyHidden>
        )}
        <DataList.Root size="1">
          <DataList.Item>
            <DataList.Label>Entry signal</DataList.Label>
            <DataList.Value>{formatSignal(strategy.entry.signal)}</DataList.Value>
          </DataList.Item>
          {strategy.exit.signal ? (
            <DataList.Item>
              <DataList.Label>Exit signal</DataList.Label>
              <DataList.Value>{formatSignal(strategy.exit.signal)}</DataList.Value>
            </DataList.Item>
          ) : null}
          {strategy.exit.profitTarget ? (
            <DataList.Item>
              <DataList.Label>Profit target</DataList.Label>
              <DataList.Value>{formatThreshold(strategy.exit.profitTarget)}</DataList.Value>
            </DataList.Item>
          ) : null}
          {strategy.exit.stopLoss ? (
            <DataList.Item>
              <DataList.Label>Stop loss</DataList.Label>
              <DataList.Value>{formatThreshold(strategy.exit.stopLoss)}</DataList.Value>
            </DataList.Item>
          ) : null}
        </DataList.Root>
        <Flex justify="end" mt="4">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              Close
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/** Render a signal as `key → value` (its edge-trigger transition). */
function formatSignal(signal: BacktestSignal): string {
  return `${signal.key} → ${String(signal.value.value)}`;
}

/** Render a threshold as `amount%` (percentage) or a bare price offset (fixed). */
function formatThreshold(threshold: BacktestThreshold): string {
  return threshold.kind === BacktestThresholdKind.Percentage
    ? `${threshold.amount}%`
    : String(threshold.amount);
}

/**
 * The right ⅓ region across the page's three states: **loaded** (a saved
 * backtest's finished-run view with a Close control), **running** (progress +
 * cancel over the results), and **idle** (the strategy manager and the run
 * form). The saved-backtests list now lives in the bottom bar's "Previous runs"
 * modal ({@link PreviousRunsDialog}), not inline here.
 *
 * The results tabs (Summary / Trades / Daily P&L) render from the loaded `view`
 * — a reloaded backtest, or the just-finished run once it flips into the loaded
 * path. A live run is progress-only, so `view` is null while it polls.
 */
function BacktestPanel({
  symbolId,
  profileId,
  period,
  runWindow,
  onRunWindowChange,
  strategyId,
  onStrategyIdChange,
  run,
  view,
  runId,
  activeBacktest,
  loaded,
  locked,
  onStarted,
  onDismiss,
  onCloseLoaded,
}: {
  symbolId: string;
  profileId: string | null;
  period: Period;
  runWindow: RangeBounds;
  onRunWindowChange: (bounds: RangeBounds) => void;
  strategyId: string | null;
  onStrategyIdChange: (id: string | null) => void;
  /** The active run's polled progress view, driving the progress bar. */
  run: BacktestRunView | null;
  /** The loaded (completed) view, backing the chart + result tabs. */
  view: LoadedBacktestView | null;
  runId: string | null;
  /** The active run's document, for its metadata while it streams. */
  activeBacktest: Backtest | null;
  loaded: Backtest | null;
  /** A run is active (or a saved backtest is loaded); strategy actions lock. */
  locked: boolean;
  onStarted: (backtest: Backtest) => void;
  onDismiss: () => void;
  onCloseLoaded: () => void;
}): ReactNode {
  if (loaded !== null) {
    return <LoadedRunPanel loaded={loaded} view={view} onClose={onCloseLoaded} />;
  }

  const idle = runId === null;
  return (
    <Card className="h-full">
      <Flex direction="column" gap="4" p="2" className="h-full overflow-y-auto">
        {idle ? (
          <>
            <Heading size="3">New run</Heading>
            <section aria-label="Backtest setup">
              <StrategyManager
                symbolId={symbolId}
                selectedId={strategyId}
                onSelectedIdChange={onStrategyIdChange}
                disabled={locked}
              />
            </section>
            <section aria-label="Backtest run">
              <RunForm
                strategyId={strategyId}
                symbolId={symbolId}
                profileId={profileId}
                period={period}
                runWindow={runWindow}
                onWindowChange={onRunWindowChange}
                onStarted={onStarted}
              />
            </section>
          </>
        ) : (
          <>
            <Heading size="3">Active run</Heading>
            {/* A run's own details, mirroring the saved-run view. */}
            {activeBacktest ? (
              <section aria-label="Run details">
                <RunMetaList backtest={activeBacktest} />
              </section>
            ) : null}
            <section aria-label="Backtest run">
              <RunProgress run={run} runId={runId} onDismiss={onDismiss} />
            </section>
            {view ? <ResultsSection view={view} /> : null}
          </>
        )}
      </Flex>
    </Card>
  );
}

/** The Summary / Trades / Daily P&L tabs over the loaded run view. */
function ResultsSection({ view }: { view: LoadedBacktestView }): ReactNode {
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
  const title = `${run.backtest.params.symbolId} ${percent}% ${formatChange(run.backtest.summary.totalPnl)} - lametrader`;
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
