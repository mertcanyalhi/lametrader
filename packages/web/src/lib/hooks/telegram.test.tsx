// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useDeleteTelegramDestination,
  useTelegramDestinations,
  useUpsertTelegramDestination,
} from './telegram';

describe('telegram hooks', () => {
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

  it('useTelegramDestinations GETs /api/config/notifications/telegram and returns name+chatId', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { name: 'main', chatId: '123' },
          { name: 'alerts', chatId: '456' },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useTelegramDestinations(), { wrapper });
    await waitFor(() => {
      expect(result.current.data).toEqual([
        { name: 'main', chatId: '123' },
        { name: 'alerts', chatId: '456' },
      ]);
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/config/notifications/telegram');
  });

  it('useUpsertTelegramDestination POSTs the input body and returns the summary', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ name: 'main', chatId: '123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpsertTelegramDestination(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ name: 'main', botToken: 'TOKEN-1', chatId: '123' });
    });
    const init = (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined) ?? {};
    expect({ url: fetchSpy.mock.calls[0]?.[0], method: init.method, body: init.body }).toEqual({
      url: '/api/config/notifications/telegram',
      method: 'POST',
      body: JSON.stringify({ name: 'main', botToken: 'TOKEN-1', chatId: '123' }),
    });
  });

  it('useDeleteTelegramDestination DELETEs /api/config/notifications/telegram/:name', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useDeleteTelegramDestination(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('main');
    });
    const init = (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined) ?? {};
    expect({ url: fetchSpy.mock.calls[0]?.[0], method: init.method }).toEqual({
      url: '/api/config/notifications/telegram/main',
      method: 'DELETE',
    });
  });
});
