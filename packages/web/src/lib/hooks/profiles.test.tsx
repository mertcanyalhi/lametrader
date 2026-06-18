// @vitest-environment jsdom
import { type Profile, ProfileScope } from '@lametrader/core';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCreateProfile, useDeleteProfile, useProfiles, useUpdateProfile } from './profiles.js';

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

/** A JSON 200/201 response of the given body. */
const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('profile mutations', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

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

  it('useCreateProfile posts the form input to /api/profiles and returns the created profile', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(profile('new'), 201));
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useCreateProfile(), { wrapper });
    let created: Profile | undefined;
    await act(async () => {
      created = await result.current.mutateAsync({
        name: 'Scalp',
        description: 'd',
        enabled: true,
      });
    });

    const init = (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined) ?? {};
    expect({
      url: (fetchSpy.mock.calls[0]?.[0] as string) ?? null,
      method: init.method ?? null,
      body: init.body ?? null,
      created,
    }).toEqual({
      url: '/api/profiles',
      method: 'POST',
      body: JSON.stringify({ name: 'Scalp', description: 'd', enabled: true }),
      created: profile('new'),
    });
  });

  it('useCreateProfile invalidates the profiles query so the list refetches', async () => {
    // First a list read primes the cache, then a create should invalidate it,
    // triggering a second GET /profiles.
    fetchSpy.mockImplementation(async (_url: string, init?: RequestInit) =>
      (init?.method ?? 'GET') === 'GET'
        ? jsonResponse([profile('a')])
        : jsonResponse(profile('b'), 201),
    );
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => ({ list: useProfiles(), create: useCreateProfile() }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.list.data).toBeDefined());
    await act(async () => {
      await result.current.create.mutateAsync({ name: 'B', description: '', enabled: true });
    });

    const getCalls = fetchSpy.mock.calls.filter(
      (call) => ((call[1] as RequestInit | undefined)?.method ?? 'GET') === 'GET',
    );
    await waitFor(() => expect(getCalls.length).toBeGreaterThanOrEqual(1));
    expect(
      fetchSpy.mock.calls.filter(
        (call) => ((call[1] as RequestInit | undefined)?.method ?? 'GET') === 'GET',
      ).length,
    ).toEqual(2);
  });

  it('useUpdateProfile patches /api/profiles/:id with only name, description and enabled', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(profile('a')));
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useUpdateProfile(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        id: 'a',
        input: { name: 'Renamed', description: 'x', enabled: false },
      });
    });

    const init = (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined) ?? {};
    expect({
      url: (fetchSpy.mock.calls[0]?.[0] as string) ?? null,
      method: init.method ?? null,
      body: init.body ?? null,
    }).toEqual({
      url: '/api/profiles/a',
      method: 'PATCH',
      body: JSON.stringify({ name: 'Renamed', description: 'x', enabled: false }),
    });
  });

  it('useDeleteProfile deletes /api/profiles/:id', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useDeleteProfile(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('a');
    });

    const init = (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined) ?? {};
    expect({
      url: (fetchSpy.mock.calls[0]?.[0] as string) ?? null,
      method: init.method ?? null,
    }).toEqual({ url: '/api/profiles/a', method: 'DELETE' });
  });
});
