// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  type FiredRuleEvent,
  type RuleEventContext,
  type RuleEventEntry,
  RuleEventKind,
  RuleEventType,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventsDialog } from './events-dialog';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

const PAGE_SIZE = 50;

let queryClient: QueryClient;

function renderDialog(node: ReturnType<typeof EventsDialog>): void {
  render(
    <QueryClientProvider client={queryClient}>
      <Theme>{node}</Theme>
    </QueryClientProvider>,
  );
}

/** Build a `Fired` event with the given timestamp. */
function fired(ts: number, ruleId = 'r-1'): RuleEventEntry {
  return { type: RuleEventType.Fired, ts, ruleId, symbolId: 'crypto:BTCUSDT' };
}

/** A captured per-event context (#304). */
function sampleContext(): RuleEventContext {
  return {
    inboundEvent: {
      kind: RuleEventKind.CurrentValueChanged,
      ts: 1_700_000_000_000,
      symbolId: 'crypto:BTCUSDT',
      prev: null,
      current: 65000,
      final: false,
    },
    lookupSnapshot: {
      current: 65000,
      open: 64500,
      high: 65100,
      low: 64400,
      close: 65000,
      volume: 1234.56,
    },
  };
}

/** A `Fired` event carrying captured per-event context. */
function firedWithContext(ts: number): FiredRuleEvent {
  return {
    type: RuleEventType.Fired,
    ts,
    ruleId: 'r-1',
    symbolId: 'crypto:BTCUSDT',
    context: sampleContext(),
  };
}

describe('EventsDialog', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the empty-state message when the API returns an empty page', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response('[]', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    renderDialog(
      <EventsDialog
        open={true}
        onOpenChange={vi.fn()}
        mode={{ kind: 'rule', ruleId: 'r-1', ruleName: 'BTC alert' }}
      />,
    );
    expect(await screen.findByRole('status')).toHaveTextContent('No events recorded yet.');
  });

  it('renders the events as rows from `GET /rules/:id/events` in rule mode', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify([fired(1_700_000_000_000), fired(1_700_000_120_000)]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    globalThis.fetch = fetchSpy;
    renderDialog(
      <EventsDialog
        open={true}
        onOpenChange={vi.fn()}
        mode={{ kind: 'rule', ruleId: 'r-1', ruleName: 'BTC alert' }}
      />,
    );
    await waitFor(() => {
      expect(
        within(screen.getByRole('dialog')).queryByRole('cell', {
          name: '2023-11-14 22:13:20.000',
        }),
      ).not.toBeNull();
    });
    expect(
      String((fetchSpy as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] ?? ''),
    ).toBe('/api/rules/r-1/events?limit=50');
  });

  it('hits `GET /symbols/:id/rule-events` in symbol mode', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    globalThis.fetch = fetchSpy;
    renderDialog(
      <EventsDialog
        open={true}
        onOpenChange={vi.fn()}
        mode={{ kind: 'symbol', symbolId: 'crypto:BTCUSDT' }}
      />,
    );
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(
      String((fetchSpy as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] ?? ''),
    ).toBe('/api/symbols/crypto%3ABTCUSDT/rule-events?limit=50');
  });

  it('renders an info icon on Fired rows whose entry carries a context (#304)', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify([firedWithContext(1_700_000_000_000)]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    renderDialog(
      <EventsDialog
        open={true}
        onOpenChange={vi.fn()}
        mode={{ kind: 'rule', ruleId: 'r-1', ruleName: 'BTC alert' }}
      />,
    );

    expect(await screen.findByRole('button', { name: 'Show fire context' })).toBeInTheDocument();
  });

  it('omits the info icon on Fired rows without a captured context (#304)', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify([fired(1_700_000_000_000)]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    renderDialog(
      <EventsDialog
        open={true}
        onOpenChange={vi.fn()}
        mode={{ kind: 'rule', ruleId: 'r-1', ruleName: 'BTC alert' }}
      />,
    );

    await waitFor(() => {
      expect(
        within(screen.getByRole('dialog')).queryByRole('cell', {
          name: '2023-11-14 22:13:20.000',
        }),
      ).not.toBeNull();
    });
    expect(screen.queryByRole('button', { name: 'Show fire context' })).toBeNull();
  });

  it('opens a Fire context modal with inbound event + lookup snapshot when the info icon is clicked (#304)', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify([firedWithContext(1_700_000_000_000)]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    renderDialog(
      <EventsDialog
        open={true}
        onOpenChange={vi.fn()}
        mode={{ kind: 'rule', ruleId: 'r-1', ruleName: 'BTC alert' }}
      />,
    );
    const trigger = await screen.findByRole('button', { name: 'Show fire context' });
    const user = userEvent.setup();

    await user.click(trigger);

    const modal = await screen.findByRole('dialog', { name: 'Fire context' });
    expect({
      kind: within(modal).getByRole('rowheader', { name: 'kind' }).nextSibling?.textContent,
      symbolId: within(modal).getByRole('rowheader', { name: 'symbolId' }).nextSibling?.textContent,
      open: within(modal).getByRole('rowheader', { name: 'open' }).nextSibling?.textContent,
      close: within(modal).getByRole('rowheader', { name: 'close' }).nextSibling?.textContent,
      volume: within(modal).getByRole('rowheader', { name: 'volume' }).nextSibling?.textContent,
    }).toEqual({
      kind: 'currentValueChanged',
      symbolId: 'crypto:BTCUSDT',
      open: '64500',
      close: '65000',
      volume: '1234.56',
    });
  });

  it('paginates with "Load more" using the oldest event\'s `ts` as the `before` cursor', async () => {
    const firstPage = Array.from({ length: PAGE_SIZE }, (_, i) =>
      fired(2_000_000_000_000 - i * 1_000),
    );
    const oldestOfFirst = firstPage[PAGE_SIZE - 1];
    if (!oldestOfFirst) throw new Error('first page must be full');
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(firstPage), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    renderDialog(
      <EventsDialog
        open={true}
        onOpenChange={vi.fn()}
        mode={{ kind: 'rule', ruleId: 'r-1', ruleName: 'BTC alert' }}
      />,
    );
    const loadMore = await screen.findByRole('button', { name: 'Load more' });
    const user = userEvent.setup();

    await user.click(loadMore);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    expect(String(fetchSpy.mock.calls[1]?.[0] ?? '')).toBe(
      `/api/rules/r-1/events?limit=50&before=${oldestOfFirst.ts}`,
    );
  });
});
