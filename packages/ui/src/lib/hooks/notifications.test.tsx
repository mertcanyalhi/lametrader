// @vitest-environment jsdom
import { NotificationChannel } from '@lametrader/core';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useCreateNotification,
  useDeleteNotification,
  useNotification,
  useNotifications,
  useUpdateNotification,
} from './notifications';

describe('notification hooks', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function makeWrapper(): { wrapper: (props: { children: ReactNode }) => ReactNode } {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return { wrapper };
  }

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('useNotifications GETs /api/config/notifications and returns the summaries', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse([
        { id: 'a', notificationType: 'telegram', name: 'main' },
        { id: 'b', notificationType: 'telegram', name: 'alerts' },
      ]),
    );
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => {
      expect(result.current.data).toEqual([
        { id: 'a', notificationType: 'telegram', name: 'main' },
        { id: 'b', notificationType: 'telegram', name: 'alerts' },
      ]);
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/config/notifications');
  });

  it('useNotification GETs /api/config/notifications/:id and returns the view', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: 'a', notificationType: 'telegram', name: 'main', chatId: '123' }),
    );
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useNotification('a'), { wrapper });
    await waitFor(() => {
      expect(result.current.data).toEqual({
        id: 'a',
        notificationType: 'telegram',
        name: 'main',
        chatId: '123',
      });
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/config/notifications/a');
  });

  it('useCreateNotification POSTs the input body and returns the view', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: 'a', notificationType: 'telegram', name: 'main', chatId: '123' }),
    );
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useCreateNotification(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        notificationType: NotificationChannel.Telegram,
        name: 'main',
        botToken: 'TOKEN-1',
        chatId: '123',
      });
    });
    const init = (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined) ?? {};
    expect({ url: fetchSpy.mock.calls[0]?.[0], method: init.method, body: init.body }).toEqual({
      url: '/api/config/notifications',
      method: 'POST',
      body: JSON.stringify({
        notificationType: 'telegram',
        name: 'main',
        botToken: 'TOKEN-1',
        chatId: '123',
      }),
    });
  });

  it('useUpdateNotification PATCHes /api/config/notifications/:id with the patch body', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: 'a', notificationType: 'telegram', name: 'renamed', chatId: '456' }),
    );
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateNotification(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'a', patch: { name: 'renamed', chatId: '456' } });
    });
    const init = (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined) ?? {};
    expect({ url: fetchSpy.mock.calls[0]?.[0], method: init.method, body: init.body }).toEqual({
      url: '/api/config/notifications/a',
      method: 'PATCH',
      body: JSON.stringify({ name: 'renamed', chatId: '456' }),
    });
  });

  it('useDeleteNotification DELETEs /api/config/notifications/:id', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useDeleteNotification(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('a');
    });
    const init = (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined) ?? {};
    expect({ url: fetchSpy.mock.calls[0]?.[0], method: init.method }).toEqual({
      url: '/api/config/notifications/a',
      method: 'DELETE',
    });
  });
});
