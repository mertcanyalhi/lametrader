// @vitest-environment jsdom
import { Period } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartEmptyState } from './empty-state.js';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));

describe('ChartEmptyState', () => {
  afterEach(() => cleanup());

  it('opens the backfill dialog when "Run backfill" is clicked', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <Theme>
          <ChartEmptyState id="crypto:BTCUSDT" periods={[Period.OneHour, Period.OneDay]} />
        </Theme>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Run backfill' }));
    await screen.findByText('Backfill history');

    expect({
      dialogOpen: screen.queryByText('Backfill history') !== null,
      hasStart: screen.queryByRole('button', { name: 'Start backfill' }) !== null,
    }).toEqual({ dialogOpen: true, hasStart: true });
  });
});
