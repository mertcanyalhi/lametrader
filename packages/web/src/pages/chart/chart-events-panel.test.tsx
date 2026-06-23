// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { type RuleEventEntry, RuleEventType } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHART_EVENTS_PANEL_OPEN_KEY } from '../../lib/chart-events-panel.js';
import { ChartEventsPanel } from './chart-events-panel';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

let queryClient: QueryClient;

function renderPanel(): void {
  render(
    <QueryClientProvider client={queryClient}>
      <Theme>
        <ChartEventsPanel symbolId="crypto:BTCUSDT" />
      </Theme>
    </QueryClientProvider>,
  );
}

function fired(ts: number): RuleEventEntry {
  return { type: RuleEventType.Fired, ts, ruleId: 'r-1', symbolId: 'crypto:BTCUSDT' };
}

describe('ChartEventsPanel', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('starts collapsed when no persisted state exists and skips fetching', () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response('[]', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    globalThis.fetch = fetchSpy;
    renderPanel();
    expect({
      expandToggle: screen.queryByRole('button', { name: 'Expand events panel' }) !== null,
      fetched: (fetchSpy as unknown as { mock: { calls: unknown[][] } }).mock.calls.length,
    }).toEqual({ expandToggle: true, fetched: 0 });
  });

  it('renders events when expanded and persists the open flag', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify([fired(1_700_000_000_000)]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    renderPanel();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Expand events panel' }));

    await waitFor(() => {
      expect(screen.queryByRole('cell', { name: '2023-11-14 22:13:20' })).not.toBeNull();
    });
    expect(window.localStorage.getItem(CHART_EVENTS_PANEL_OPEN_KEY)).toBe('true');
  });

  it('reopens with the persisted open state on next mount', () => {
    window.localStorage.setItem(CHART_EVENTS_PANEL_OPEN_KEY, 'true');
    globalThis.fetch = vi.fn(
      async () =>
        new Response('[]', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    renderPanel();
    expect(screen.getByRole('button', { name: 'Collapse events panel' })).toBeInTheDocument();
  });
});
