import type {
  Backtest,
  BacktestOpenPosition,
  BacktestParams,
  BacktestProgress,
  BacktestStatus,
  BacktestSummary,
  BacktestTrade,
  Candle,
  RuleEventEntry,
} from '@lametrader/core';
import { useQuery } from '@tanstack/react-query';
import { useBacktestEvents } from './backtests.js';
import { fetchRangeCandles } from './candles.js';

/** Milliseconds in one day — turns the replay window into a fractional-day span. */
const MS_PER_DAY = 86_400_000;

/**
 * The fully-rendered view of a completed backtest the page draws — chart,
 * markers, overlays, and the result tabs. The live run no longer produces this
 * incrementally (it is progress-only until it completes); the completed run is
 * rendered through this one path, whether reloaded from the saved list or
 * transitioned into from a run that just finished.
 */
export interface LoadedBacktestView {
  /** The run's lifecycle status (always completed here). */
  status: BacktestStatus;
  /** Replay progress — a completed run is fully elapsed. */
  progress: BacktestProgress;
  /** The immutable run inputs. */
  params: BacktestParams;
  /** Run-period candles for the chart, ascending by time. */
  chartCandles: Candle[];
  /** Closed trades, in exit order. */
  trades: BacktestTrade[];
  /** Summary over the closed trades. */
  summary: BacktestSummary;
  /** The position open at the end, if any. */
  openPosition: BacktestOpenPosition | undefined;
  /** Run events, in engine emission order. */
  events: RuleEventEntry[];
}

/**
 * Rehydrate a saved backtest into a {@link LoadedBacktestView} so the chart,
 * trade markers, state overlays, and result tabs render from a completed run —
 * whether reloaded from the saved list or just transitioned in from a finished
 * run.
 *
 * The persisted document already carries the trades, summary, open position, and
 * params; the two derived surfaces are refetched over REST from their stored
 * sources: the run-period candles from the candle store (via
 * {@link fetchRangeCandles}) and the events from the windowed events route
 * (ascending, via {@link useBacktestEvents}). `progress` is reported fully
 * elapsed — a completed backtest has no live frontier.
 *
 * @param backtest - the completed backtest to load, or `null` when idle.
 */
export function useLoadedBacktest(backtest: Backtest | null): LoadedBacktestView | null {
  const candles = useQuery({
    queryKey: ['loaded-backtest-candles', backtest?.id],
    queryFn: () =>
      backtest
        ? fetchRangeCandles(
            backtest.params.symbolId,
            backtest.params.period,
            backtest.params.start,
            backtest.params.end,
          )
        : [],
    enabled: backtest !== null,
  });
  const events = useBacktestEvents(backtest?.id ?? null);

  if (!backtest) return null;
  const totalDays = Math.max(0, (backtest.params.end - backtest.params.start) / MS_PER_DAY);
  return {
    status: backtest.status,
    progress: { elapsedDays: totalDays, totalDays },
    params: backtest.params,
    chartCandles: candles.data ?? [],
    trades: backtest.trades,
    summary: backtest.summary,
    openPosition: backtest.openPosition,
    events: events.data ?? [],
  };
}
