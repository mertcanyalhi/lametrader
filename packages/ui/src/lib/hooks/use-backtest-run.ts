import { type Backtest, type BacktestProgress, BacktestStatus } from '@lametrader/core';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-fetch.js';

/** Milliseconds in one day — a completed run reports its window fully elapsed. */
const MS_PER_DAY = 86_400_000;

/** How often (ms) the run is polled for progress while it is still running. */
const POLL_INTERVAL_MS = 1000;

/** A running backtest as `GET /backtests/:id` returns it — the document plus live progress. */
type PolledBacktest = Backtest & { progress?: BacktestProgress };

/**
 * The run the panel wants watched: its id. There is no stream anymore, so
 * whether it is a reattach or a run we just started is immaterial — either way
 * the panel polls the same endpoint.
 */
export interface ActiveBacktest {
  /** The run id to watch. */
  id: string;
}

/**
 * The polled view of a run the panel renders: the run's status, its live
 * progress, and the backtest document itself (handed to the loaded-backtest path
 * once it completes).
 */
export interface BacktestRunView {
  /** The run's lifecycle status after the latest poll. */
  status: BacktestStatus;
  /** Replay progress after the latest poll. */
  progress: BacktestProgress;
  /** The running (or just-completed) backtest document. */
  backtest: Backtest;
}

/** The replay window fully elapsed — the progress a completed backtest reports. */
function elapsedProgress(backtest: Backtest): BacktestProgress {
  const totalDays = Math.max(0, (backtest.params.end - backtest.params.start) / MS_PER_DAY);
  return { elapsedDays: totalDays, totalDays };
}

/**
 * Poll one backtest run (`GET /backtests/:id`) for its progress until it
 * completes, or `null` when nothing is active or before the first response.
 *
 * The run publishes no stream (ADR-0022): the panel shows a progress bar driven
 * by this poll while the run is `Running`, and the page hands the finished
 * document to the loaded-backtest path once it reaches `Completed`. Polling stops
 * as soon as the status is no longer `Running` (a completed run needs no further
 * refetch — its document is immutable).
 *
 * @param active - the run to watch (its id), or `null` for idle.
 */
export function useBacktestRun(active: ActiveBacktest | null): BacktestRunView | null {
  const id = active?.id ?? null;
  const query = useQuery({
    queryKey: ['backtest-run', id],
    queryFn: () => apiFetch<PolledBacktest>(`/backtests/${encodeURIComponent(id ?? '')}`),
    enabled: id !== null,
    refetchInterval: (q) =>
      q.state.data?.status === BacktestStatus.Running ? POLL_INTERVAL_MS : false,
  });

  const data = query.data;
  if (id === null || data === undefined) return null;
  return {
    status: data.status,
    progress: data.progress ?? elapsedProgress(data),
    backtest: data,
  };
}
