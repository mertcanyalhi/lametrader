import type {
  IndicatorComputeResult,
  IndicatorDefinition,
  IndicatorInstance,
  IndicatorStatePoint,
  Period,
} from '@lametrader/core';
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '../api-fetch.js';
import { StreamKind } from '../stream/stream-client.types.js';
import { useStreamSubscription } from '../stream/use-stream-subscription.js';
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
  /** Inclusive lower bound (epoch ms) for the returned state rows — scopes the engine's candle load. Omitted ⇒ no lower bound. */
  from?: number;
  /** Exclusive upper bound (epoch ms) for the returned state rows. Omitted ⇒ no upper bound. */
  to?: number;
}

/**
 * TanStack Query options for one indicator's compute — extracted so the chart
 * page can pass an array of these to `useQueries` (one per applicable
 * instance), while the single-instance form remains a plain hook below.
 */
export function computeIndicatorQueryOptions(input: ComputeIndicatorInput) {
  const { id, key, period, inputs, from, to } = input;
  return {
    queryKey: ['symbol-indicator', id, key, period, inputs, from, to] as const,
    queryFn: () =>
      apiFetch<IndicatorComputeResult>(buildComputeUrl(id, key, period, inputs, from, to)),
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

/**
 * Build the compute URL: `period` first, then optional `from` / `to` (so the
 * scoped-window flag reads left-to-right), then inputs sorted alphabetically
 * for a stable order across renders + tests.
 */
function buildComputeUrl(
  id: string,
  key: string,
  period: Period,
  inputs: Record<string, unknown>,
  from?: number,
  to?: number,
): string {
  const params = new URLSearchParams();
  params.set('period', period);
  if (from !== undefined) params.set('from', String(from));
  if (to !== undefined) params.set('to', String(to));
  for (const k of Object.keys(inputs).sort()) {
    params.set(k, String(inputs[k]));
  }
  return `/symbols/${id}/indicators/${key}?${params.toString()}`;
}

/** Input to {@link useIndicatorStream} — uniquely identifies one live subscription. */
export interface IndicatorStreamInput {
  /** Canonical symbol id. */
  id: string;
  /** Candle period the indicator is computed on. */
  period: Period;
  /** Indicator catalog key (e.g. `'sma'`). */
  key: string;
  /** Validated input values, keyed by descriptor key. */
  inputs: Record<string, unknown>;
}

/** The latest live state row + closed flag for one indicator subscription. */
export interface IndicatorStreamLatest {
  /** The state row at the just-arrived candle's time. */
  state: IndicatorStatePoint;
  /** Whether the underlying candle is closed (`true`) or still forming (`false`). */
  final: boolean;
}

/**
 * Stable JSON of `inputs` so a fresh `{ length: 14 }` per render still
 * keys off the same value-stable identity (the effect re-subscribes only when
 * the *content* changes, not the reference).
 */
function inputsKey(inputs: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(inputs)
      .sort()
      .map((k) => [k, inputs[k]] as const),
  );
}

/**
 * Subscribe to a symbol's live indicator-state feed over the shared `/stream`
 * client for one `(id, period, key, inputs)` tuple, and return the latest
 * `{ state, final }` — or `null` before the first frame (and after the tuple
 * changes, until a new frame arrives under the new key).
 *
 * The hook keeps the latest frame stamped with the tuple it arrived for, so
 * a tuple change reads back `null` until the new subscription emits — no stale
 * state under the new key.
 */
export function useIndicatorStream(input: IndicatorStreamInput): IndicatorStreamLatest | null {
  const { id, period, key, inputs } = input;
  const [latest, setLatest] = useState<{ tupleKey: string; value: IndicatorStreamLatest } | null>(
    null,
  );
  const stableInputs = inputsKey(inputs);
  const tupleKey = `${id}:${period}:${key}:${stableInputs}`;

  useStreamSubscription(
    StreamKind.Indicator,
    { id, period, indicator: { key, inputs } },
    (event) =>
      setLatest({
        tupleKey,
        value: { state: event.state, final: event.final },
      }),
    [id, period, key, stableInputs],
  );

  return latest?.tupleKey === tupleKey ? latest.value : null;
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
