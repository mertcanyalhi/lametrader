import type { Backtest } from '@lametrader/core';
import { useQuery } from '@tanstack/react-query';
import { useBacktestEvents } from './backtests.js';
import { fetchRangeCandles } from './candles.js';
import type { BacktestRunView } from './use-backtest-run.js';

/** Milliseconds in one day — turns the replay window into a fractional-day span. */
const MS_PER_DAY = 86_400_000;

/**
 * Rehydrate a saved backtest into the same {@link BacktestRunView} the live run
 * renders, so the chart, trade markers, state overlays, and result tabs read a
 * loaded backtest identically to a run in flight — no run started.
 *
 * The persisted document already carries the trades, summary, open position, and
 * params; the two run-only surfaces are refetched over REST from their stored
 * sources: the run-period candles from the candle store (the same
 * {@link fetchRangeCandles} the reattach path uses) and the events from the
 * windowed events route (ascending, via {@link useBacktestEvents}). `progress`
 * is reported fully elapsed — a completed backtest has no live frontier — so the
 * shared view shape stays satisfied without a progress bar.
 *
 * @param backtest - the completed backtest to load, or `null` when idle.
 */
export function useLoadedBacktest(backtest: Backtest | null): BacktestRunView | null {
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
