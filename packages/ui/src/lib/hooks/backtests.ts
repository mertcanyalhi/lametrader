import { type Backtest, BacktestStatus, type RuleEventEntry } from '@lametrader/core';
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
 * Stable key for the completed-backtests list query (the saved-backtests panel).
 *
 * The rename / delete mutations below invalidate it so a successful round trip
 * refetches the list, and a run reaching `Completed` invalidates it so the newly
 * saved backtest appears.
 */
export const COMPLETED_BACKTESTS_QUERY_KEY = ['backtests', 'completed'] as const;

/** The `limit` requested for a loaded backtest's events window (the server caps at 500). */
const BACKTEST_EVENTS_LIMIT = 500;

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
 * Fetch every completed backtest (`GET /backtests?status=completed`).
 *
 * Backs the saved-backtests panel: the list of finished runs a user can reload,
 * rename, or delete. The server merges the in-memory running run into the
 * unfiltered list, so the `?status=completed` filter keeps the panel to the
 * persisted, reloadable backtests only.
 */
export function useCompletedBacktests(): UseQueryResult<Backtest[], Error> {
  return useQuery({
    queryKey: COMPLETED_BACKTESTS_QUERY_KEY,
    queryFn: () => apiFetch<Backtest[]>(`/backtests?status=${BacktestStatus.Completed}`),
  });
}

/** The arguments to {@link useRenameBacktest}: the backtest id plus its new name. */
export interface RenameBacktestInput {
  /** The completed backtest to rename. */
  id: string;
  /** The new display name (non-empty). */
  name: string;
}

/**
 * Rename a completed backtest (`PATCH /backtests/:id`).
 *
 * Only a completed backtest can be renamed; the server returns `400` for a
 * running one. On success the completed-list query is invalidated so the panel
 * refetches the new name.
 */
export function useRenameBacktest(): UseMutationResult<Backtest, Error, RenameBacktestInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: RenameBacktestInput) =>
      apiFetch<Backtest>(`/backtests/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COMPLETED_BACKTESTS_QUERY_KEY }),
  });
}

/**
 * Delete a completed backtest (`DELETE /backtests/:id`).
 *
 * The delete cascades the backtest's run events server-side. On success both the
 * completed-list and running-discovery queries are invalidated so the panel and
 * the reattach probe drop the removed run. (Cancelling an *in-flight* run uses
 * {@link useCancelBacktest}, which hits the same endpoint but only touches the
 * running query.)
 */
export function useDeleteBacktest(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/backtests/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: COMPLETED_BACKTESTS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: RUNNING_BACKTEST_QUERY_KEY });
    },
  });
}

/**
 * Fetch a backtest's run events (`GET /backtests/:id/events`), ascending by `ts`.
 *
 * Loading a saved backtest reads its events from this windowed route (the server
 * returns them newest-first, capped at 500) to drive the chart's state overlays;
 * they are re-sorted ascending here so the overlay series read in emission order.
 * Disabled (and idle) until an `id` is supplied.
 *
 * @param id - the completed backtest id, or `null` when nothing is loaded.
 */
export function useBacktestEvents(id: string | null): UseQueryResult<RuleEventEntry[], Error> {
  return useQuery({
    queryKey: ['backtest-events', id],
    queryFn: async () => {
      if (id === null) return [];
      const events = await apiFetch<RuleEventEntry[]>(
        `/backtests/${encodeURIComponent(id)}/events?limit=${BACKTEST_EVENTS_LIMIT}`,
      );
      return [...events].sort((a, b) => a.ts - b.ts);
    },
    enabled: id !== null,
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
