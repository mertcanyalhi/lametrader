// @vitest-environment jsdom
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelectedProfileProvider } from '../../lib/selected-profile/selected-profile-context.js';
import { StatusBar } from './status-bar.js';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

describe('StatusBar', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('opens the manage-profiles dialog from the Manage profiles control', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
      <QueryClientProvider client={client}>
        <Theme>
          <SelectedProfileProvider>{children}</SelectedProfileProvider>
        </Theme>
      </QueryClientProvider>
    );
    render(<StatusBar />, { wrapper });

    await userEvent.click(screen.getByRole('button', { name: 'Manage profiles' }));

    await waitFor(() =>
      expect(screen.getByText('Create, edit, or delete your profiles.')).toBeInTheDocument(),
    );
  });
});
