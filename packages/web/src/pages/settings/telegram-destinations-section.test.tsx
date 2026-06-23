// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { Theme } from '@radix-ui/themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramDestinationsSection } from './telegram-destinations-section';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

let queryClient: QueryClient;
let destinations: Array<{ name: string; chatId: string }>;
let postBodies: Array<unknown>;
let deleteCalls: Array<string>;

function installFetch(): void {
  postBodies = [];
  deleteCalls = [];
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = String(url);
    if (method === 'GET' && path.endsWith('/notification/telegram/destinations')) {
      return new Response(JSON.stringify(destinations), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (method === 'POST' && path.endsWith('/notification/telegram/destinations')) {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      postBodies.push(body);
      destinations = [...destinations, { name: String(body.name), chatId: String(body.chatId) }];
      return new Response(JSON.stringify({ name: body.name, chatId: body.chatId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (method === 'DELETE' && path.includes('/notification/telegram/destinations/')) {
      const name = decodeURIComponent(path.split('/').pop() ?? '');
      deleteCalls.push(name);
      destinations = destinations.filter((d) => d.name !== name);
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected fetch: ${method} ${url}`);
  }) as unknown as typeof fetch;
}

function renderSection(): void {
  render(
    <QueryClientProvider client={queryClient}>
      <Theme>
        <TelegramDestinationsSection />
      </Theme>
    </QueryClientProvider>,
  );
}

describe('TelegramDestinationsSection', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    destinations = [];
    installFetch();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the empty-state when no destinations are configured', async () => {
    renderSection();
    expect(await screen.findByRole('status')).toHaveTextContent('No destinations configured.');
  });

  it('renders one row per destination with name + chatId', async () => {
    destinations = [
      { name: 'main', chatId: '123' },
      { name: 'alerts', chatId: '456' },
    ];
    renderSection();
    await waitFor(() => {
      expect(screen.queryByRole('cell', { name: 'main' })).not.toBeNull();
    });
    expect(screen.getByRole('cell', { name: '456' })).toBeInTheDocument();
  });

  it('posts the form values and refreshes the list when Add succeeds', async () => {
    renderSection();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Add destination' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'main');
    await user.type(within(dialog).getByLabelText('Bot token'), 'TOKEN-1');
    await user.type(within(dialog).getByRole('textbox', { name: 'Chat id' }), '123');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect({
      posted: postBodies,
      visibleName: screen.queryByRole('cell', { name: 'main' }) !== null,
    }).toEqual({
      posted: [{ name: 'main', botToken: 'TOKEN-1', chatId: '123' }],
      visibleName: true,
    });
  });

  it('renders an inline "Name is required." and skips POST when the form is submitted blank', async () => {
    renderSection();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Add destination' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));

    const alerts = await within(dialog).findAllByRole('alert');
    expect({
      hasNameRequired: alerts.some((alert) => alert.textContent === 'Name is required.'),
      postCount: postBodies.length,
    }).toEqual({ hasNameRequired: true, postCount: 0 });
  });

  it('deletes a destination via the AlertDialog Confirm flow', async () => {
    destinations = [{ name: 'main', chatId: '123' }];
    renderSection();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Delete main' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );

    await waitFor(() => expect(deleteCalls).toEqual(['main']));
  });
});
