// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { Theme } from '@radix-ui/themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartEventsButton } from './chart-events-button';

let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  globalThis.fetch = vi.fn(
    async () =>
      new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderButton(): void {
  render(
    <QueryClientProvider client={queryClient}>
      <Theme>
        <ChartEventsButton symbolId="crypto:BTCUSDT" />
      </Theme>
    </QueryClientProvider>,
  );
}

describe('ChartEventsButton', () => {
  it('opens the symbol events dialog when the Events button is clicked', async () => {
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: 'Events' }));
    await waitFor(() =>
      expect(screen.getByRole('dialog')).toHaveAccessibleName('Events — crypto:BTCUSDT'),
    );
  });
});
