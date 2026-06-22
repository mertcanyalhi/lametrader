// @vitest-environment jsdom
import { StateValueType } from '@lametrader/core';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGlobalState, useSymbolState } from './state';

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

  it('useSymbolState GETs /api/symbols/:id/state and returns a populated map', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          armed: { type: StateValueType.Bool, value: true },
          cooldown: { type: StateValueType.Number, value: 42 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const { result } = renderHook(() => useSymbolState('crypto:BTCUSDT'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.data).toEqual({
        armed: { type: 'bool', value: true },
        cooldown: { type: 'number', value: 42 },
      });
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/symbols/crypto%3ABTCUSDT/state');
  });

  it('useSymbolState resolves with {} when the API returns an empty map', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const { result } = renderHook(() => useSymbolState('crypto:BTCUSDT'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.data).toEqual({});
    });
  });

  it('useGlobalState GETs /api/state/global and returns a populated map', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ regime: { type: StateValueType.Enum, value: 'risk-on' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { result } = renderHook(() => useGlobalState(), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.data).toEqual({
        regime: { type: 'enum', value: 'risk-on' },
      });
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/state/global');
  });

  it('useGlobalState resolves with {} when no global keys are set', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const { result } = renderHook(() => useGlobalState(), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.data).toEqual({});
    });
  });
});
