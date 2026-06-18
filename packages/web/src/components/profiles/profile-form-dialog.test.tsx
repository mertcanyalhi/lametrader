// @vitest-environment jsdom
import { type Profile, ProfileScope } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelectedProfileProvider } from '../../lib/selected-profile/selected-profile-context.js';
import { ProfileFormDialog } from './profile-form-dialog.js';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

import { toast } from 'sonner';

/** A persisted profile with the given id / name / enabled flag. */
const profile = (id: string, name: string, enabled: boolean): Profile => ({
  id,
  name,
  description: '',
  enabled,
  scope: { type: ProfileScope.All },
  createdAt: 0,
  updatedAt: 0,
  indicators: [],
});

/** A JSON response of the given body + status. */
const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Render the dialog with a real QueryClient + selection provider over a mocked fetch. */
function renderDialog(props: { onOpenChange: (open: boolean) => void; profile?: Profile }): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
    <QueryClientProvider client={client}>
      <Theme>
        <SelectedProfileProvider>{children}</SelectedProfileProvider>
      </Theme>
    </QueryClientProvider>
  );
  render(
    <ProfileFormDialog open={true} onOpenChange={props.onOpenChange} profile={props.profile} />,
    {
      wrapper,
    },
  );
}

/** Parse the recorded fetch call's request body as JSON. */
function recordedBody(fetchSpy: ReturnType<typeof vi.fn>): unknown {
  const init = (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined) ?? {};
  return JSON.parse(String(init.body));
}

describe('ProfileFormDialog', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('creates a profile, selects it, toasts, and closes on submit', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(profile('new', 'Scalp', true), 201));
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange });

    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Scalp');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect({
      url: (fetchSpy.mock.calls[0]?.[0] as string) ?? null,
      method: (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.method ?? null,
      body: recordedBody(fetchSpy),
      stored: window.localStorage.getItem('selected-profile'),
      toast: (toast.success as ReturnType<typeof vi.fn>).mock.calls,
    }).toEqual({
      url: '/api/profiles',
      method: 'POST',
      body: { name: 'Scalp', description: '', enabled: true },
      stored: 'new',
      toast: [['Created Scalp']],
    });
  });

  it('pre-fills the form in edit mode and submits a PATCH', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(profile('a', 'Alpha', false)));
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange, profile: profile('a', 'Alpha', false) });
    const nameInput = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    const prefilled = nameInput.value;

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect({
      prefilled,
      url: (fetchSpy.mock.calls[0]?.[0] as string) ?? null,
      method: (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.method ?? null,
      body: recordedBody(fetchSpy),
    }).toEqual({
      prefilled: 'Alpha',
      url: '/api/profiles/a',
      method: 'PATCH',
      body: { name: 'Alpha', description: '', enabled: false },
    });
  });

  it('surfaces a duplicate-name 409 inline under the name field and stays open', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ error: 'profile name already in use: Dup' }, 409),
    );
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange });

    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Dup');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    const alert = await screen.findByRole('alert');
    expect({ error: alert.textContent, closed: onOpenChange.mock.calls }).toEqual({
      error: 'profile name already in use: Dup',
      closed: [],
    });
  });

  it('blocks submit and shows the required error when the name is empty', async () => {
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange });

    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    const alert = await screen.findByRole('alert');
    expect({ error: alert.textContent, requests: fetchSpy.mock.calls.length }).toEqual({
      error: 'Name is required.',
      requests: 0,
    });
  });
});
