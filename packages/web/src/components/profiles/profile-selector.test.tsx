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
import { ProfileSelector } from './profile-selector.js';

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

/** Render the selector with a real QueryClient + provider over a mocked fetch. */
function renderSelector(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
    <QueryClientProvider client={client}>
      <Theme>
        <SelectedProfileProvider>{children}</SelectedProfileProvider>
      </Theme>
    </QueryClientProvider>
  );
  render(<ProfileSelector />, { wrapper });
}

/** Resolve a fetch with the given profiles as the `GET /profiles` body. */
function mockProfiles(fetchSpy: ReturnType<typeof vi.fn>, profiles: Profile[]): void {
  fetchSpy.mockResolvedValue(
    new Response(JSON.stringify(profiles), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('ProfileSelector', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('lists the fetched profiles and shows the selected profile on the trigger', async () => {
    window.localStorage.setItem('selected-profile', 'b');
    mockProfiles(fetchSpy, [profile('a', 'Alpha', true), profile('b', 'Beta', true)]);
    renderSelector();
    const trigger = await screen.findByRole('combobox', { name: 'Selected profile' });
    await waitFor(() => expect(trigger).toHaveTextContent('Beta'));

    await userEvent.click(trigger);

    expect({
      trigger: trigger.textContent,
      options: screen.getAllByRole('option').map((option) => option.textContent),
    }).toEqual({ trigger: 'Beta', options: ['Alpha', 'Beta'] });
  });

  it('updates and persists the global selection when a different profile is chosen', async () => {
    window.localStorage.setItem('selected-profile', 'a');
    mockProfiles(fetchSpy, [profile('a', 'Alpha', true), profile('b', 'Beta', true)]);
    renderSelector();
    const trigger = await screen.findByRole('combobox', { name: 'Selected profile' });

    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('option', { name: 'Beta' }));

    expect({
      trigger: trigger.textContent,
      stored: window.localStorage.getItem('selected-profile'),
    }).toEqual({ trigger: 'Beta', stored: 'b' });
  });

  it('defaults to the first enabled profile and persists it when nothing is stored', async () => {
    mockProfiles(fetchSpy, [profile('a', 'Alpha', false), profile('b', 'Beta', true)]);
    renderSelector();
    const trigger = await screen.findByRole('combobox', { name: 'Selected profile' });

    await waitFor(() => expect(window.localStorage.getItem('selected-profile')).toEqual('b'));

    expect(trigger).toHaveTextContent('Beta');
  });

  it('shows "No profile" and disables the trigger when there are no profiles', async () => {
    mockProfiles(fetchSpy, []);
    renderSelector();
    const trigger = await screen.findByRole('combobox', { name: 'Selected profile' });

    await waitFor(() => expect(trigger).toHaveTextContent('No profile'));

    expect({ text: trigger.textContent, disabled: trigger.hasAttribute('data-disabled') }).toEqual({
      text: 'No profile',
      disabled: true,
    });
  });

  it('marks a disabled profile with a muted "disabled" hint in the list', async () => {
    window.localStorage.setItem('selected-profile', 'a');
    mockProfiles(fetchSpy, [profile('a', 'Alpha', true), profile('b', 'Beta', false)]);
    renderSelector();
    const trigger = await screen.findByRole('combobox', { name: 'Selected profile' });

    await userEvent.click(trigger);

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Alpha',
      'Beta (disabled)',
    ]);
  });
});
