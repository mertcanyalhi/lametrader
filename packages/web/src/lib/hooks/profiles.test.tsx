// @vitest-environment jsdom
import { type Profile, ProfileScope } from '@lametrader/core';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProfiles } from './profiles.js';

/** A persisted profile, all fields fixed so the payload assertion is exact. */
const profile = (id: string): Profile => ({
  id,
  name: `Profile ${id}`,
  description: '',
  enabled: true,
  scope: { type: ProfileScope.All },
  createdAt: 0,
  updatedAt: 0,
  indicators: [],
});

/**
 * Tests for the `useProfiles` query hook. Mocks at the `fetch` boundary so the
 * real `apiFetch` + a real `QueryClient` are exercised (mirrors
 * `use-config.test.tsx`).
 */
describe('useProfiles', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function wrapper({ children }: { children: ReactNode }): ReactNode {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  it('issues GET /api/profiles and returns the profiles', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([profile('a'), profile('b')]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { result } = renderHook(() => useProfiles(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    expect({
      url: (fetchSpy.mock.calls[0]?.[0] as string) ?? null,
      method: (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.method ?? 'GET',
      data: result.current.data,
    }).toEqual({
      url: '/api/profiles',
      method: 'GET',
      data: [profile('a'), profile('b')],
    });
  });
});
