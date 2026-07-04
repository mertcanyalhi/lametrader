// @vitest-environment jsdom
import { Period } from '@lametrader/core';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConfig, useUpdateConfig } from './use-config';

/**
 * Tests for the `useConfig` / `useUpdateConfig` React Query hooks.
 *
 * Mock at the `fetch` boundary, not at `apiFetch`, so the real `apiFetch` and
 * the real `QueryClient` are exercised end-to-end.
 */
describe('useConfig / useUpdateConfig', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  /**
   * Build a fresh wrapper-with-its-own-`QueryClient` per test so cache state
   * doesn't leak between cases.
   */
  function makeWrapper(): {
    wrapper: (props: { children: ReactNode }) => ReactNode;
    client: QueryClient;
  } {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return { wrapper, client };
  }

  it('useConfig issues GET /api/config and returns the response data', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ periods: [Period.OneHour, Period.OneDay], defaultPeriod: Period.OneDay }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useConfig(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual({
        periods: [Period.OneHour, Period.OneDay],
        defaultPeriod: Period.OneDay,
      });
    });
    expect({
      url: (fetchSpy.mock.calls[0]?.[0] as string) ?? null,
      method: (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.method ?? 'GET',
    }).toEqual({ url: '/api/config', method: 'GET' });
  });

  it('useUpdateConfig issues PUT /api/config and writes the response into the cache', async () => {
    const response = {
      periods: [Period.OneMinute, Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneHour,
    };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { wrapper, client } = makeWrapper();

    const { result } = renderHook(() => useUpdateConfig(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(response);
    });

    const recordedCall = fetchSpy.mock.calls[0];
    const init = (recordedCall?.[1] as RequestInit | undefined) ?? {};
    expect({
      url: (recordedCall?.[0] as string) ?? null,
      method: init.method ?? null,
      body: init.body ?? null,
      cached: client.getQueryData(['config']),
    }).toEqual({
      url: '/api/config',
      method: 'PUT',
      body: JSON.stringify(response),
      cached: response,
    });
  });
});
