import { type Backtest, BacktestStatus } from '@lametrader/core';
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiFetch } from '../api-fetch.js';
import type { BacktestRunInput } from '../backtest.types.js';

/** Stable key for the running-backtest discovery query (reattach on revisit). */
export const RUNNING_BACKTEST_QUERY_KEY = ['backtests', 'running'] as const;

/**
 * Start a backtest run (`POST /backtests`). Returns the created **running**
 * backtest (the server replies **202** with `status: running` and a progress
 * snapshot); the panel then subscribes its stream via {@link useBacktestRun}.
 *
 * Only one run may be active at a time, so a start while another run is in flight
 * raises `ApiError` with status `409`; an invalid request raises `400`. Both
 * surface to the caller for inline / toast feedback. On success the running-run
 * discovery query is invalidated so a reattaching client sees the new run.
 */
export function useStartBacktest(): UseMutationResult<Backtest, Error, BacktestRunInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BacktestRunInput) =>
      apiFetch<Backtest>('/backtests', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RUNNING_BACKTEST_QUERY_KEY }),
  });
}

/**
 * Cancel (running) or delete (completed) a backtest (`DELETE /backtests/:id`).
 *
 * A running run is cancelled and discarded — nothing is persisted — returning
 * the page to idle. On success the running-run discovery query is invalidated so
 * the cancelled run is no longer re-attached to.
 */
export function useCancelBacktest(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/backtests/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RUNNING_BACKTEST_QUERY_KEY }),
  });
}

/**
 * Discover the active running backtest, if any (`GET /backtests?status=running`).
 *
 * Only one run may be active server-side, so the first element (when present) is
 * *the* active run. The panel reads this once on mount to reattach after a
 * navigation away: the run survives the client leaving, and revisiting resumes
 * streaming it. Returns the (at most one) running backtest.
 */
export function useRunningBacktest(): UseQueryResult<Backtest[], Error> {
  return useQuery({
    queryKey: RUNNING_BACKTEST_QUERY_KEY,
    queryFn: () => apiFetch<Backtest[]>(`/backtests?status=${BacktestStatus.Running}`),
  });
}
