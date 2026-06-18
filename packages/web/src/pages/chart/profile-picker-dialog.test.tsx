// @vitest-environment jsdom
import { type Profile, ProfileScope } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SELECTED_PROFILE_STORAGE_KEY, setStoredProfileId } from '../../lib/selected-profile.js';
import { SelectedProfileProvider } from '../../lib/selected-profile-context.js';
import { ProfilePickerDialog } from './profile-picker-dialog.js';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

const NOW = 1_700_000_000_000;

const SCALPER: Profile = {
  id: 'p-1',
  name: 'Scalper',
  description: 'fast moves',
  enabled: true,
  scope: { type: ProfileScope.All },
  createdAt: NOW,
  updatedAt: NOW,
  indicators: [],
};

const SWING: Profile = {
  id: 'p-2',
  name: 'Swing',
  description: 'multi-day',
  enabled: true,
  scope: { type: ProfileScope.All },
  createdAt: NOW,
  updatedAt: NOW,
  indicators: [],
};

const DISABLED: Profile = {
  id: 'p-3',
  name: 'Retired',
  description: 'paused',
  enabled: false,
  scope: { type: ProfileScope.All },
  createdAt: NOW,
  updatedAt: NOW,
  indicators: [],
};

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

interface Matcher {
  match: (url: string, method: string) => boolean;
  respond: () => { status: number; body: unknown };
}

describe('ProfilePickerDialog', () => {
  let queryClient: QueryClient;
  let calls: FetchCall[];
  let matchers: Matcher[];
  let profiles: Profile[];

  beforeEach(() => {
    calls = [];
    matchers = [];
    profiles = [SCALPER, SWING, DISABLED];
    // Default: GET /profiles returns the seed list (mutated by tests below).
    matchers.push({
      match: (url, method) => method === 'GET' && url.endsWith('/profiles'),
      respond: () => ({ status: 200, body: profiles }),
    });

    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      const matcher = matchers.find((m) => m.match(url, method));
      if (!matcher) throw new Error(`unexpected fetch: ${method} ${url}`);
      const { status, body: responseBody } = matcher.respond();
      return new Response(status === 204 ? null : JSON.stringify(responseBody), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  function renderPicker(): void {
    render(
      <QueryClientProvider client={queryClient}>
        <Theme>
          <SelectedProfileProvider>
            <ProfilePickerDialog />
          </SelectedProfileProvider>
        </Theme>
      </QueryClientProvider>,
    );
  }

  /** Open the picker dialog by clicking its trigger (whatever label it carries). */
  async function openPicker(triggerName: RegExp | string): Promise<void> {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: triggerName }));
    await screen.findByRole('dialog');
  }

  it('labels the trigger button with the active profile name when one is selected', async () => {
    setStoredProfileId(SCALPER.id);

    renderPicker();

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: SCALPER.name })).not.toBeNull(),
    );
  });

  it('labels the trigger button "No profile" when nothing is selected', async () => {
    // Empty profile list so first-run defaulting can't pick one.
    profiles = [];

    renderPicker();

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'No profile' })).not.toBeNull(),
    );
  });

  it('lists every profile from GET /profiles when opened, with a "disabled" hint on disabled ones', async () => {
    renderPicker();
    await openPicker('No profile');

    const dialog = screen.getByRole('dialog');

    expect({
      scalper: within(dialog).queryByText(SCALPER.name) !== null,
      swing: within(dialog).queryByText(SWING.name) !== null,
      retired: within(dialog).queryByText(DISABLED.name) !== null,
      disabledHint: within(dialog).queryAllByText(/disabled/i).length,
    }).toEqual({ scalper: true, swing: true, retired: true, disabledHint: 1 });
  });

  it('selects a profile when its row is clicked, closes the dialog, and writes to localStorage', async () => {
    renderPicker();
    await openPicker('No profile');
    const user = userEvent.setup();

    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: `Select ${SWING.name}` }),
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect({
      stored: window.localStorage.getItem(SELECTED_PROFILE_STORAGE_KEY),
      triggerLabel: screen.queryByRole('button', { name: SWING.name }) !== null,
    }).toEqual({ stored: SWING.id, triggerLabel: true });
  });

  it('creates a profile when "New profile…" is submitted and selects it', async () => {
    profiles = [];
    const created: Profile = {
      id: 'p-new',
      name: 'Day Trade',
      description: 'intraday',
      enabled: true,
      scope: { type: ProfileScope.All },
      createdAt: NOW,
      updatedAt: NOW,
      indicators: [],
    };
    matchers.push({
      match: (url, method) => method === 'POST' && url.endsWith('/profiles'),
      respond: () => {
        profiles = [created];
        return { status: 201, body: created };
      },
    });
    renderPicker();
    await openPicker('No profile');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /new profile/i }));
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), created.name);
    await user.type(screen.getByRole('textbox', { name: 'Description' }), created.description);
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: created.name })).not.toBeNull(),
    );
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/profiles'));
    expect({
      body: post?.body,
      stored: window.localStorage.getItem(SELECTED_PROFILE_STORAGE_KEY),
    }).toEqual({
      body: {
        name: created.name,
        description: created.description,
        enabled: true,
        scope: { type: 'all' },
      },
      stored: created.id,
    });
  });

  it('surfaces a 409 from POST /profiles inline under the name field', async () => {
    profiles = [];
    matchers.push({
      match: (url, method) => method === 'POST' && url.endsWith('/profiles'),
      respond: () => ({ status: 409, body: { error: 'profile name "Scalper" already exists' } }),
    });
    renderPicker();
    await openPicker('No profile');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /new profile/i }));
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'Scalper');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    const nameField = await screen.findByRole('textbox', { name: 'Name' });
    const errorId = nameField.getAttribute('aria-describedby');
    const errorText = errorId ? document.getElementById(errorId)?.textContent : null;
    expect({
      ariaInvalid: nameField.getAttribute('aria-invalid'),
      errorText,
      stored: window.localStorage.getItem(SELECTED_PROFILE_STORAGE_KEY),
    }).toEqual({
      ariaInvalid: 'true',
      errorText: 'profile name "Scalper" already exists',
      stored: null,
    });
  });

  it('edits a profile via PATCH /profiles/:id with only name/description/enabled', async () => {
    setStoredProfileId(SCALPER.id);
    const renamed: Profile = { ...SCALPER, name: 'Quick', description: 'edited' };
    matchers.push({
      match: (url, method) => method === 'PATCH' && url.endsWith(`/profiles/${SCALPER.id}`),
      respond: () => {
        profiles = profiles.map((p) => (p.id === SCALPER.id ? renamed : p));
        return { status: 200, body: renamed };
      },
    });
    renderPicker();
    await openPicker(SCALPER.name);
    const user = userEvent.setup();

    const row = within(screen.getByRole('dialog')).getByText(SCALPER.name).closest('div');
    if (!row) throw new Error('row not found');
    await user.click(within(row as HTMLElement).getByRole('button', { name: /edit/i }));
    const nameField = await screen.findByRole('textbox', { name: 'Name' });
    await user.clear(nameField);
    await user.type(nameField, renamed.name);
    const descField = screen.getByRole('textbox', { name: 'Description' });
    await user.clear(descField);
    await user.type(descField, renamed.description);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: renamed.name })).not.toBeNull(),
    );
    const patch = calls.find(
      (c) => c.method === 'PATCH' && c.url.endsWith(`/profiles/${SCALPER.id}`),
    );
    expect(patch?.body).toEqual({
      name: renamed.name,
      description: renamed.description,
      enabled: true,
    });
  });

  it('deletes the selected profile and falls back to the first remaining enabled profile', async () => {
    setStoredProfileId(SCALPER.id);
    matchers.push({
      match: (url, method) => method === 'DELETE' && url.endsWith(`/profiles/${SCALPER.id}`),
      respond: () => {
        profiles = profiles.filter((p) => p.id !== SCALPER.id);
        return { status: 204, body: null };
      },
    });
    renderPicker();
    await openPicker(SCALPER.name);
    const user = userEvent.setup();

    const row = within(screen.getByRole('dialog')).getByText(SCALPER.name).closest('div');
    if (!row) throw new Error('row not found');
    await user.click(within(row as HTMLElement).getByRole('button', { name: /delete/i }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: SWING.name })).not.toBeNull());
    expect(window.localStorage.getItem(SELECTED_PROFILE_STORAGE_KEY)).toEqual(SWING.id);
  });

  it('falls back to "No profile" when deleting the only enabled profile leaves none', async () => {
    profiles = [SCALPER];
    setStoredProfileId(SCALPER.id);
    matchers.push({
      match: (url, method) => method === 'DELETE' && url.endsWith(`/profiles/${SCALPER.id}`),
      respond: () => {
        profiles = [];
        return { status: 204, body: null };
      },
    });
    renderPicker();
    await openPicker(SCALPER.name);
    const user = userEvent.setup();

    const row = within(screen.getByRole('dialog')).getByText(SCALPER.name).closest('div');
    if (!row) throw new Error('row not found');
    await user.click(within(row as HTMLElement).getByRole('button', { name: /delete/i }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'No profile' })).not.toBeNull(),
    );
    expect(window.localStorage.getItem(SELECTED_PROFILE_STORAGE_KEY)).toEqual(null);
  });

  it('does not mutate location.search when a profile is selected from the modal', async () => {
    const before = window.location.search;
    renderPicker();
    await openPicker('No profile');
    const user = userEvent.setup();

    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: `Select ${SWING.name}` }),
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.search).toEqual(before);
  });
});
