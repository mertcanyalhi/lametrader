// @vitest-environment jsdom
import { type Profile, ProfileScope } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteProfileDialog } from './delete-profile-dialog.js';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

import { toast } from 'sonner';

/** A persisted profile with the given id / name. */
const profile = (id: string, name: string): Profile => ({
  id,
  name,
  description: '',
  enabled: true,
  scope: { type: ProfileScope.All },
  createdAt: 0,
  updatedAt: 0,
  indicators: [],
});

function renderDialog(onOpenChange: (open: boolean) => void): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
    <QueryClientProvider client={client}>
      <Theme>{children}</Theme>
    </QueryClientProvider>
  );
  render(
    <DeleteProfileDialog open={true} onOpenChange={onOpenChange} profile={profile('a', 'Alpha')} />,
    { wrapper },
  );
}

describe('DeleteProfileDialog', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('names the profile and deletes it on confirm, then toasts and closes', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const onOpenChange = vi.fn();
    renderDialog(onOpenChange);
    const named = screen.getByText(/Delete .Alpha./).textContent;

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect({
      named,
      url: (fetchSpy.mock.calls[0]?.[0] as string) ?? null,
      method: (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.method ?? null,
      toast: (toast.success as ReturnType<typeof vi.fn>).mock.calls,
    }).toEqual({
      named: 'Delete “Alpha”? This can’t be undone.',
      url: '/api/profiles/a',
      method: 'DELETE',
      toast: [['Deleted Alpha']],
    });
  });
});
