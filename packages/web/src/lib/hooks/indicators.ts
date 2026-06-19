import type {
  IndicatorComputeResult,
  IndicatorDefinition,
  IndicatorInstance,
  Period,
} from '@lametrader/core';
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiFetch } from '../api-fetch.js';
import { PROFILES_QUERY_KEY } from './profiles.js';

/** Stable key for the indicator-catalog query (`GET /indicators`). */
export const INDICATOR_CATALOG_QUERY_KEY = ['indicators'] as const;

/** Input to {@link useAttachIndicator}'s `mutateAsync`. */
export interface AttachIndicatorInput {
  /** The catalog key of the indicator to attach. */
  indicatorKey: string;
  /** Validated input values keyed by descriptor key. */
  inputs: Record<string, unknown>;
  /** Optional alias to distinguish multiple attachments of the same indicator. */
  label?: string;
}

/** Input to {@link useUpdateIndicator}'s `mutateAsync`. */
export interface UpdateIndicatorInput extends AttachIndicatorInput {
  /** The id of the existing instance to replace. */
  instanceId: string;
}

/**
 * Read every registered indicator definition (`GET /indicators`). The catalog
 * is the source of truth for input/state descriptors the inputs form renders.
 */
export function useIndicatorCatalog(): UseQueryResult<IndicatorDefinition[], Error> {
  return useQuery({
    queryKey: INDICATOR_CATALOG_QUERY_KEY,
    queryFn: () => apiFetch<IndicatorDefinition[]>('/indicators'),
  });
}

/**
 * Attach an indicator to the given profile (`POST /profiles/:profileId/indicators`).
 * On success the profiles query is invalidated so the panel's instance list and
 * trigger count both refresh.
 */
export function useAttachIndicator(
  profileId: string,
): UseMutationResult<IndicatorInstance, Error, AttachIndicatorInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AttachIndicatorInput) =>
      apiFetch<IndicatorInstance>(`/profiles/${profileId}/indicators`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PROFILES_QUERY_KEY }),
  });
}

/**
 * Replace an existing instance (`PUT /profiles/:profileId/indicators/:instanceId`).
 * Full-replace — the body carries the (unchanged) `indicatorKey` and the new
 * `inputs`. Invalidates the profiles query on success.
 */
export function useUpdateIndicator(
  profileId: string,
): UseMutationResult<IndicatorInstance, Error, UpdateIndicatorInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ instanceId, ...body }: UpdateIndicatorInput) =>
      apiFetch<IndicatorInstance>(`/profiles/${profileId}/indicators/${instanceId}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PROFILES_QUERY_KEY }),
  });
}

/** Input to {@link useComputeIndicator}'s query — uniquely identifies one compute. */
export interface ComputeIndicatorInput {
  /** The symbol id whose candles drive the computation. */
  id: string;
  /** The indicator's catalog key (e.g. `'sma'`). */
  key: string;
  /** The candle period the compute runs over. */
  period: Period;
  /** The indicator's input values, keyed by descriptor key. */
  inputs: Record<string, unknown>;
}

/**
 * TanStack Query options for one indicator's compute — extracted so the chart
 * page can pass an array of these to `useQueries` (one per applicable
 * instance), while the single-instance form remains a plain hook below.
 */
export function computeIndicatorQueryOptions(input: ComputeIndicatorInput) {
  const { id, key, period, inputs } = input;
  return {
    queryKey: ['symbol-indicator', id, key, period, inputs] as const,
    queryFn: () => apiFetch<IndicatorComputeResult>(buildComputeUrl(id, key, period, inputs)),
    enabled: id !== '' && key !== '' && period !== undefined,
  };
}

/**
 * Compute one indicator's historical state for a symbol on a given period
 * (`GET /symbols/:id/indicators/:key?period=&<inputs>`).
 *
 * Inputs are sorted alphabetically before being appended to the query string,
 * so an identical `(id, key, period, inputs)` always hits the same URL — both
 * for cache reuse and for a stable assertion in tests.
 *
 * The query is enabled only when `id`, `key`, and `period` are all set, so
 * callers can pass empty intermediate values without firing a stray request.
 */
export function useComputeIndicator(
  input: ComputeIndicatorInput,
): UseQueryResult<IndicatorComputeResult, Error> {
  return useQuery(computeIndicatorQueryOptions(input));
}

/** Build the compute URL with inputs sorted into a stable querystring order. */
function buildComputeUrl(
  id: string,
  key: string,
  period: Period,
  inputs: Record<string, unknown>,
): string {
  const params = new URLSearchParams();
  params.set('period', period);
  for (const k of Object.keys(inputs).sort()) {
    params.set(k, String(inputs[k]));
  }
  return `/symbols/${id}/indicators/${key}?${params.toString()}`;
}

/**
 * Detach an existing instance (`DELETE /profiles/:profileId/indicators/:instanceId`).
 * Invalidates the profiles query on success so the row disappears.
 */
export function useDetachIndicator(profileId: string): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (instanceId: string) =>
      apiFetch<void>(`/profiles/${profileId}/indicators/${instanceId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PROFILES_QUERY_KEY }),
  });
}
