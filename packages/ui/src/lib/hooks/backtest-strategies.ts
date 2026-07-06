import type { BacktestStrategy, BacktestStrategyFields } from '@lametrader/core';
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiFetch } from '../api-fetch.js';

/**
 * Stable key for the backtest-strategy list query.
 *
 * The create / replace / delete mutations below invalidate it so a successful
 * round trip refetches the selector's list.
 */
export const BACKTEST_STRATEGIES_QUERY_KEY = ['backtest-strategies'] as const;

/** Fetch every backtest strategy (`GET /backtest-strategies`). */
export function useBacktestStrategies(): UseQueryResult<BacktestStrategy[], Error> {
  return useQuery({
    queryKey: BACKTEST_STRATEGIES_QUERY_KEY,
    queryFn: () => apiFetch<BacktestStrategy[]>('/backtest-strategies'),
  });
}

/**
 * Create a new backtest strategy (`POST /backtest-strategies`).
 *
 * On success the list query is invalidated so the selector refetches; a
 * duplicate name surfaces as a `409` {@link ApiError} the caller renders inline.
 */
export function useCreateBacktestStrategy(): UseMutationResult<
  BacktestStrategy,
  Error,
  BacktestStrategyFields
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fields: BacktestStrategyFields) =>
      apiFetch<BacktestStrategy>('/backtest-strategies', {
        method: 'POST',
        body: JSON.stringify(fields),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: BACKTEST_STRATEGIES_QUERY_KEY }),
  });
}

/**
 * The arguments to {@link useUpdateBacktestStrategy}: the strategy id to replace
 * plus its full new field set.
 */
export interface UpdateBacktestStrategyInput {
  /** The strategy id to replace. */
  id: string;
  /** The full mutable field set (name / description / entry / exit). */
  fields: BacktestStrategyFields;
}

/**
 * Fully replace a backtest strategy's mutable fields (`PUT /backtest-strategies/:id`).
 *
 * The editor always submits the complete field set, so a `PUT` (replace) — not a
 * `PATCH` — matches the backend contract; on success the list query is
 * invalidated so the selector refetches.
 */
export function useUpdateBacktestStrategy(): UseMutationResult<
  BacktestStrategy,
  Error,
  UpdateBacktestStrategyInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, fields }: UpdateBacktestStrategyInput) =>
      apiFetch<BacktestStrategy>(`/backtest-strategies/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(fields),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: BACKTEST_STRATEGIES_QUERY_KEY }),
  });
}

/**
 * Delete a backtest strategy (`DELETE /backtest-strategies/:id`).
 *
 * On success the list query is invalidated so the selector refetches; deleting a
 * strategy never cascades to saved backtests (they carry their own snapshot).
 */
export function useDeleteBacktestStrategy(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/backtest-strategies/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: BACKTEST_STRATEGIES_QUERY_KEY }),
  });
}
