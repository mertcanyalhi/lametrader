// @vitest-environment jsdom
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsSection } from './notifications-section';

/**
 * Notifications section tests — drive the generic table + dialogs against a
 * router-style mocked `fetch`, exercising the real `apiFetch`, `QueryClient`,
 * and `react-hook-form`. `sonner` is mocked so the toast is observable.
 */
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

import { toast } from 'sonner';

/** A JSON response helper. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('NotificationsSection', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  /**
   * Install a router `fetch` returning `list` for the list GET, `view` for a
   * detail GET, and canned responses for the mutations.
   */
  function installFetch(opts: {
    list: unknown[];
    view?: unknown;
    created?: unknown;
    updated?: unknown;
  }): void {
    fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = String(url);
      if (path === '/api/config/notifications' && method === 'GET') return json(opts.list);
      if (path === '/api/config/notifications' && method === 'POST') return json(opts.created, 201);
      if (path.startsWith('/api/config/notifications/') && method === 'GET') return json(opts.view);
      if (path.startsWith('/api/config/notifications/') && method === 'PATCH')
        return json(opts.updated);
      if (path.startsWith('/api/config/notifications/') && method === 'DELETE')
        return new Response(null, { status: 204 });
      throw new Error(`unexpected fetch: ${method} ${path}`);
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  }

  function renderSection(): void {
    render(
      <QueryClientProvider client={queryClient}>
        <Theme>
          <NotificationsSection />
        </Theme>
      </QueryClientProvider>,
    );
  }

  /** The mutation body of the first request matching `method`. */
  function bodyOf(method: string): string | undefined {
    const call = fetchSpy.mock.calls.find(
      (c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === method,
    );
    return (call?.[1] as RequestInit | undefined)?.body as string | undefined;
  }

  it('renders the empty state when no notifications are configured', async () => {
    installFetch({ list: [] });
    renderSection();
    expect(await screen.findByText('No notifications configured.')).toBeInTheDocument();
  });

  it('renders a row per config showing its notification type and name', async () => {
    installFetch({ list: [{ id: 'a', notificationType: 'telegram', name: 'main' }] });
    renderSection();

    const row = await screen.findByRole('row', { name: /main/ });
    expect({
      type: within(row).getByText('Telegram').textContent,
      name: within(row).getByText('main').textContent,
      hasEdit: within(row).getByRole('button', { name: 'Edit main' }) !== null,
      hasDelete: within(row).getByRole('button', { name: 'Delete main' }) !== null,
    }).toEqual({ type: 'Telegram', name: 'main', hasEdit: true, hasDelete: true });
  });

  it('creates a notification via POST and surfaces the success toast', async () => {
    installFetch({
      list: [],
      created: { id: 'a', notificationType: 'telegram', name: 'main', chatId: '123' },
    });
    renderSection();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Add notification' }));
    await user.type(await screen.findByLabelText('Name'), 'main');
    await user.type(screen.getByLabelText('Bot token'), 'TOKEN-1');
    await user.type(screen.getByLabelText('Chat id'), '123');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Add' }));
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Saved main');
    });
    expect(bodyOf('POST')).toEqual(
      JSON.stringify({
        notificationType: 'telegram',
        name: 'main',
        botToken: 'TOKEN-1',
        chatId: '123',
      }),
    );
  });

  it('flags the blank create form and issues no POST', async () => {
    installFetch({ list: [] });
    renderSection();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Add notification' }));
    await act(async () => {
      await user.click(await screen.findByRole('button', { name: 'Add' }));
    });

    await waitFor(() => {
      expect(screen.getByText('Name is required.')).toBeInTheDocument();
    });
    expect(
      fetchSpy.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST'),
    ).toEqual([]);
  });

  it('opens the edit dialog prefilled from GET /:id and submits a PATCH', async () => {
    installFetch({
      list: [{ id: 'a', notificationType: 'telegram', name: 'main' }],
      view: { id: 'a', notificationType: 'telegram', name: 'main', chatId: '123' },
      updated: { id: 'a', notificationType: 'telegram', name: 'main', chatId: '456' },
    });
    renderSection();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Edit main' }));
    // The dialog prefills name + chat id from the detail GET.
    const chatId = await screen.findByLabelText('Chat id');
    await waitFor(() => expect((chatId as HTMLInputElement).value).toBe('123'));
    await user.clear(chatId);
    await user.type(chatId, '456');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Save' }));
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Saved main');
    });
    expect(bodyOf('PATCH')).toEqual(JSON.stringify({ name: 'main', chatId: '456' }));
  });

  it('deletes a notification via DELETE after confirming', async () => {
    installFetch({ list: [{ id: 'a', notificationType: 'telegram', name: 'main' }] });
    renderSection();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Delete main' }));
    await act(async () => {
      // The AlertDialog's confirm action.
      await user.click(await screen.findByRole('button', { name: 'Delete' }));
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Deleted main');
    });
    expect(
      fetchSpy.mock.calls.some(
        (c) =>
          String(c[0]) === '/api/config/notifications/a' &&
          (c[1] as RequestInit | undefined)?.method === 'DELETE',
      ),
    ).toBe(true);
  });
});
