// @vitest-environment jsdom
import { type Profile, ProfileScope } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelectedProfileProvider } from '../../lib/selected-profile/selected-profile-context.js';
import { ManageProfilesDialog } from './manage-profiles-dialog.js';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

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

describe('ManageProfilesDialog', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify([profile('a', 'Alpha', true), profile('b', 'Beta', false)]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('lists every profile with Edit and Delete controls plus a New profile action', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
      <QueryClientProvider client={client}>
        <Theme>
          <SelectedProfileProvider>{children}</SelectedProfileProvider>
        </Theme>
      </QueryClientProvider>
    );
    render(<ManageProfilesDialog open={true} onOpenChange={vi.fn()} />, { wrapper });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit Alpha' })).toBeInTheDocument(),
    );
    expect({
      editAlpha: screen.getByRole('button', { name: 'Edit Alpha' }).tagName,
      deleteAlpha: screen.getByRole('button', { name: 'Delete Alpha' }).tagName,
      editBeta: screen.getByRole('button', { name: 'Edit Beta' }).tagName,
      deleteBeta: screen.getByRole('button', { name: 'Delete Beta' }).tagName,
      newProfile: screen.getByRole('button', { name: 'New profile' }).tagName,
    }).toEqual({
      editAlpha: 'BUTTON',
      deleteAlpha: 'BUTTON',
      editBeta: 'BUTTON',
      deleteBeta: 'BUTTON',
      newProfile: 'BUTTON',
    });
  });
});
