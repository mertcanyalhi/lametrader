// @vitest-environment jsdom
import { StateValueType } from '@lametrader/core';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useGlobalState,
  useSymbolState,
  useSymbolStateKeys,
  useSymbolStateTimeSeries,
} from './state';

describe('state hooks', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function makeWrapper(): (props: { children: ReactNode }) => ReactNode {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  it('useSymbolState GETs /api/symbols/:id/state?profileId=... and returns a populated map', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          armed: { type: StateValueType.Bool, value: true },
          cooldown: { type: StateValueType.Number, value: 42 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const { result } = renderHook(() => useSymbolState('profile-1', 'crypto:BTCUSDT'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.data).toEqual({
        armed: { type: 'bool', value: true },
        cooldown: { type: 'number', value: 42 },
      });
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      '/api/symbols/crypto%3ABTCUSDT/state?profileId=profile-1',
    );
  });

  it('useSymbolState resolves with {} when the API returns an empty map', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const { result } = renderHook(() => useSymbolState('profile-1', 'crypto:BTCUSDT'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.data).toEqual({});
    });
  });

  it('useSymbolState stays disabled when profileId is empty', () => {
    const { result } = renderHook(() => useSymbolState('', 'crypto:BTCUSDT'), {
      wrapper: makeWrapper(),
    });
    expect({ fetched: fetchSpy.mock.calls.length, data: result.current.data }).toEqual({
      fetched: 0,
      data: undefined,
    });
  });

  it('useGlobalState GETs /api/profiles/:profileId/state/global and returns a populated map', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ regime: { type: StateValueType.Enum, value: 'risk-on' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { result } = renderHook(() => useGlobalState('profile-1'), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.data).toEqual({
        regime: { type: 'enum', value: 'risk-on' },
      });
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/profiles/profile-1/state/global');
  });

  it('useGlobalState resolves with {} when no global keys are set', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const { result } = renderHook(() => useGlobalState('profile-1'), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.data).toEqual({});
    });
  });

  it('useGlobalState stays disabled when profileId is empty', () => {
    const { result } = renderHook(() => useGlobalState(''), { wrapper: makeWrapper() });
    expect({ fetched: fetchSpy.mock.calls.length, data: result.current.data }).toEqual({
      fetched: 0,
      data: undefined,
    });
  });

  it('useSymbolStateKeys GETs /api/symbols/:id/state-keys and returns the descriptor list', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { key: 'cooldown', valueType: 'number' },
          { key: 'last_signal', valueType: 'string' },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const { result } = renderHook(() => useSymbolStateKeys('crypto:BTCUSDT'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.data).toEqual([
        { key: 'cooldown', valueType: StateValueType.Number },
        { key: 'last_signal', valueType: StateValueType.String },
      ]);
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/symbols/crypto%3ABTCUSDT/state-keys');
  });

  it('useSymbolStateTimeSeries GETs /api/symbols/:id/state/:key/series with from/to and returns the series', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { ts: 1, value: { type: 'string', value: 'buy' } },
          { ts: 5, value: null },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const { result } = renderHook(
      () =>
        useSymbolStateTimeSeries({
          symbolId: 'crypto:BTCUSDT',
          key: 'last_signal',
          from: 0,
          to: 10,
        }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => {
      expect(result.current.data).toEqual([
        { ts: 1, value: { type: 'string', value: 'buy' } },
        { ts: 5, value: null },
      ]);
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      '/api/symbols/crypto%3ABTCUSDT/state/last_signal/series?from=0&to=10',
    );
  });
});
