// @vitest-environment jsdom
import { type EnrichedSymbol, type Instrument, Period, SymbolType } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WatchlistPage } from './watchlist-page';

/**
 * Watchlist page tests — drive the real page against a mocked `fetch` boundary
 * so the real `apiFetch`, `QueryClient`, and the symbols hooks are exercised.
 *
 * `sonner` is mocked at module level so success/error toasts are observable via
 * the spies without rendering the actual `<Toaster />`.
 */
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

import { toast } from 'sonner';

/** A fully-enriched Bitcoin row with a non-null snapshot quote. */
const BTC: EnrichedSymbol = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'Bitcoin',
  exchange: 'Binance',
  currency: 'USDT',
  periods: [Period.OneHour, Period.OneDay],
  quote: { price: 45_000.5, change: 1500, changePct: 0.0345, period: Period.OneDay, time: 1 },
};

/** An enriched Ethereum row whose quote could not be computed (`null`). */
const ETH: EnrichedSymbol = {
  id: 'crypto:ETHUSDT',
  type: SymbolType.Crypto,
  description: 'Ethereum',
  exchange: 'Binance',
  currency: 'USDT',
  periods: [Period.OneHour],
  quote: null,
};

/** An equity row, for cross-type sorting. */
const AAPL: EnrichedSymbol = {
  id: 'stock:AAPL',
  type: SymbolType.Stock,
  description: 'Apple Inc.',
  exchange: 'NMS',
  currency: 'USD',
  periods: [Period.OneDay],
  quote: { price: 190.25, change: -2.5, changePct: -0.0386, period: Period.OneDay, time: 1 },
};

/** An fx row, for cross-type sorting. */
const EUR: EnrichedSymbol = {
  id: 'fx:EURUSD',
  type: SymbolType.Fx,
  description: 'Euro / US Dollar',
  exchange: 'FX',
  currency: 'USD',
  periods: [Period.OneHour],
  quote: { price: 1.08, change: 0.001, changePct: 0.001, period: Period.OneDay, time: 1 },
};

/** The platform config the page reads for default + available periods. */
const CONFIG = {
  periods: [Period.OneMinute, Period.OneHour, Period.OneDay],
  defaultPeriod: Period.OneHour,
};

describe('WatchlistPage', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let queryClient: QueryClient;
  /** Ordered request matchers; first whose method + url-substring match wins. */
  let matchers: Array<{
    method: string;
    includes: string;
    body: () => unknown;
    status: number;
  }>;

  beforeEach(() => {
    vi.clearAllMocks();
    matchers = [];
    fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const match = matchers.find((m) => m.method === method && String(url).includes(m.includes));
      if (!match) throw new Error(`unexpected fetch: ${method} ${url}`);
      const payload = match.body();
      return new Response(match.status === 204 ? null : JSON.stringify(payload), {
        status: match.status,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  /** Register a response for the next request whose method + url-substring match. */
  function onRequest(method: string, includes: string, body: () => unknown, status = 200): void {
    matchers.push({ method, includes, body, status });
  }

  function renderPage(): void {
    render(
      <QueryClientProvider client={queryClient}>
        <Theme>
          <MemoryRouter>
            <WatchlistPage />
          </MemoryRouter>
        </Theme>
      </QueryClientProvider>,
    );
  }

  /** The symbol id rendered in each body row, top to bottom (excludes the header row). */
  function bodyRowIds(): string[] {
    return screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getByText(/^(crypto|stock|fx):/).textContent ?? '');
  }

  it('renders a row per enriched symbol with id, description, type, quote, and period chips', async () => {
    onRequest('GET', '/symbols?enrich=true', () => [BTC]);
    onRequest('GET', '/config', () => CONFIG);
    renderPage();

    await screen.findByText('crypto:BTCUSDT');
    expect({
      id: screen.getByText('crypto:BTCUSDT').textContent,
      description: screen.getByText('Bitcoin').textContent,
      type: screen.getByText('crypto').textContent,
      price: screen.getByText('45,000.50').textContent,
      change: screen.getByText('+1,500.00').textContent,
      changePct: screen.getByText('+3.45%').textContent,
      periodOneHour: screen.getByText('1h').textContent,
      periodOneDay: screen.getByText('1d').textContent,
    }).toEqual({
      id: 'crypto:BTCUSDT',
      description: 'Bitcoin',
      type: 'crypto',
      price: '45,000.50',
      change: '+1,500.00',
      changePct: '+3.45%',
      periodOneHour: '1h',
      periodOneDay: '1d',
    });
  });

  it('renders skeleton rows while the list query is pending', () => {
    fetchSpy.mockReturnValue(new Promise(() => undefined));
    renderPage();

    expect({
      hasSkeleton: screen.getByTestId('watchlist-skeleton') !== null,
      hasRows: screen.queryByText('crypto:BTCUSDT'),
    }).toEqual({ hasSkeleton: true, hasRows: null });
  });

  it('renders an empty state with a "Watch a symbol" action when the list is empty', async () => {
    onRequest('GET', '/symbols?enrich=true', () => []);
    onRequest('GET', '/config', () => CONFIG);
    renderPage();

    const button = await screen.findByRole('button', { name: 'Watch a symbol' });
    expect({
      hasButton: button !== null,
      hasTable: screen.queryByRole('table'),
    }).toEqual({ hasButton: true, hasTable: null });
  });

  it('renders an error callout with the server message when the list query fails', async () => {
    onRequest('GET', '/symbols?enrich=true', () => ({ error: 'database unavailable' }), 500);
    onRequest('GET', '/config', () => CONFIG);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('database unavailable');
    });
    expect(screen.queryByRole('table')).toEqual(null);
  });

  it('renders an em dash for price, change, and change % when the quote is null', async () => {
    onRequest('GET', '/symbols?enrich=true', () => [ETH]);
    onRequest('GET', '/config', () => CONFIG);
    renderPage();

    await screen.findByText('crypto:ETHUSDT');
    expect(screen.getAllByText('—').map((cell) => cell.textContent)).toEqual(['—', '—', '—']);
  });

  it('sorts by Symbol ascending by default', async () => {
    onRequest('GET', '/symbols?enrich=true', () => [AAPL, BTC, EUR]);
    onRequest('GET', '/config', () => CONFIG);
    renderPage();

    await screen.findByText('crypto:BTCUSDT');
    expect(bodyRowIds()).toEqual(['crypto:BTCUSDT', 'fx:EURUSD', 'stock:AAPL']);
  });

  it('toggles to descending when the Symbol header is clicked', async () => {
    onRequest('GET', '/symbols?enrich=true', () => [AAPL, BTC, EUR]);
    onRequest('GET', '/config', () => CONFIG);
    renderPage();
    const user = userEvent.setup();

    await screen.findByText('crypto:BTCUSDT');
    await user.click(screen.getByRole('button', { name: 'Symbol' }));

    expect(bodyRowIds()).toEqual(['stock:AAPL', 'fx:EURUSD', 'crypto:BTCUSDT']);
  });

  it('sorts by price ascending when the Price header is clicked', async () => {
    onRequest('GET', '/symbols?enrich=true', () => [AAPL, BTC, EUR]);
    onRequest('GET', '/config', () => CONFIG);
    renderPage();
    const user = userEvent.setup();

    await screen.findByText('crypto:BTCUSDT');
    await user.click(screen.getByRole('button', { name: 'Price' }));

    expect(bodyRowIds()).toEqual(['fx:EURUSD', 'stock:AAPL', 'crypto:BTCUSDT']);
  });

  it('sorts by change percent ascending when the Chg % header is clicked', async () => {
    onRequest('GET', '/symbols?enrich=true', () => [AAPL, BTC, EUR]);
    onRequest('GET', '/config', () => CONFIG);
    renderPage();
    const user = userEvent.setup();

    await screen.findByText('crypto:BTCUSDT');
    await user.click(screen.getByRole('button', { name: 'Chg %' }));

    expect(bodyRowIds()).toEqual(['stock:AAPL', 'fx:EURUSD', 'crypto:BTCUSDT']);
  });

  it('sorts by type ascending when the Type header is clicked', async () => {
    onRequest('GET', '/symbols?enrich=true', () => [AAPL, BTC, EUR]);
    onRequest('GET', '/config', () => CONFIG);
    renderPage();
    const user = userEvent.setup();

    await screen.findByText('crypto:BTCUSDT');
    await user.click(screen.getByRole('button', { name: 'Type' }));

    expect(bodyRowIds()).toEqual(['crypto:BTCUSDT', 'fx:EURUSD', 'stock:AAPL']);
  });

  it('adds a symbol via the search dialog, defaulting periods from the config', async () => {
    const ethInstrument: Instrument = {
      id: 'crypto:ETHUSDT',
      type: SymbolType.Crypto,
      description: 'Ethereum / TetherUS',
      exchange: 'Binance',
      currency: 'USDT',
    };
    let watchlist: EnrichedSymbol[] = [BTC];
    onRequest('GET', '/symbols?enrich=true', () => watchlist);
    onRequest('GET', '/config', () => CONFIG);
    onRequest('GET', '/instruments', () => [ethInstrument]);
    onRequest(
      'POST',
      '/symbols',
      () => {
        watchlist = [...watchlist, ETH];
        return { ...ethInstrument, periods: CONFIG.periods };
      },
      201,
    );
    renderPage();
    const user = userEvent.setup();

    await screen.findByText('crypto:BTCUSDT');
    await user.click(screen.getByRole('button', { name: 'Add symbol' }));
    await user.type(screen.getByRole('textbox', { name: 'Search instruments' }), 'eth');
    const result = await screen.findByRole('radio', { name: /crypto:ETHUSDT/ });
    await act(async () => {
      await user.click(result);
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Add' }));
    });

    // Add resolves (toast fires) and hands off to the auto-opened backfill modal.
    await waitFor(() =>
      expect(toast.success as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
        'Now watching crypto:ETHUSDT',
      ),
    );
    const postCall = fetchSpy.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect({
      url: postCall?.[0],
      body: (postCall?.[1] as RequestInit | undefined)?.body,
      toasted: (toast.success as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    }).toEqual({
      url: '/api/symbols',
      body: JSON.stringify({ id: 'crypto:ETHUSDT', periods: ['1m', '1h', '1d'] }),
      toasted: 'Now watching crypto:ETHUSDT',
    });
  });

  it('opens the backfill modal from a row’s actions, listing the symbol’s watched periods', async () => {
    onRequest('GET', '/symbols?enrich=true', () => [BTC]);
    onRequest('GET', '/config', () => CONFIG);
    renderPage();
    const user = userEvent.setup();

    await screen.findByText('crypto:BTCUSDT');
    await user.click(screen.getByRole('button', { name: 'Open actions for crypto:BTCUSDT' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Backfill' }));
    const dialog = await screen.findByRole('dialog');

    expect({
      title: within(dialog).getByText('Backfill history').textContent,
      oneHour: within(dialog).getByRole('checkbox', { name: '1h' }).getAttribute('aria-checked'),
      oneDay: within(dialog).getByRole('checkbox', { name: '1d' }).getAttribute('aria-checked'),
    }).toEqual({ title: 'Backfill history', oneHour: 'true', oneDay: 'true' });
  });

  it('auto-opens the backfill modal for a newly added symbol with its periods preselected', async () => {
    const ethInstrument: Instrument = {
      id: 'crypto:ETHUSDT',
      type: SymbolType.Crypto,
      description: 'Ethereum / TetherUS',
      exchange: 'Binance',
      currency: 'USDT',
    };
    let watchlist: EnrichedSymbol[] = [BTC];
    onRequest('GET', '/symbols?enrich=true', () => watchlist);
    onRequest('GET', '/config', () => CONFIG);
    onRequest('GET', '/instruments', () => [ethInstrument]);
    onRequest(
      'POST',
      '/symbols',
      () => {
        watchlist = [...watchlist, ETH];
        return { ...ethInstrument, periods: CONFIG.periods };
      },
      201,
    );
    renderPage();
    const user = userEvent.setup();

    await screen.findByText('crypto:BTCUSDT');
    await user.click(screen.getByRole('button', { name: 'Add symbol' }));
    await user.type(screen.getByRole('textbox', { name: 'Search instruments' }), 'eth');
    const result = await screen.findByRole('radio', { name: /crypto:ETHUSDT/ });
    await act(async () => {
      await user.click(result);
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Add' }));
    });

    const dialog = await screen.findByRole('dialog');
    expect({
      title: within(dialog).getByText('Backfill history').textContent,
      oneMinute: within(dialog).getByRole('checkbox', { name: '1m' }).getAttribute('aria-checked'),
      oneHour: within(dialog).getByRole('checkbox', { name: '1h' }).getAttribute('aria-checked'),
      oneDay: within(dialog).getByRole('checkbox', { name: '1d' }).getAttribute('aria-checked'),
    }).toEqual({ title: 'Backfill history', oneMinute: 'true', oneHour: 'true', oneDay: 'true' });
  });

  it('edits a symbol’s periods via the edit dialog’s Periods section, sending the sorted selection', async () => {
    let watchlist: EnrichedSymbol[] = [BTC];
    onRequest('GET', '/symbols?enrich=true', () => watchlist);
    onRequest('GET', '/config', () => CONFIG);
    onRequest(
      'PATCH',
      '/symbols/crypto:BTCUSDT',
      () => {
        watchlist = [{ ...BTC, periods: [Period.OneMinute, Period.OneHour, Period.OneDay] }];
        return { ...BTC, periods: [Period.OneMinute, Period.OneHour, Period.OneDay] };
      },
      200,
    );
    renderPage();
    const user = userEvent.setup();

    await screen.findByText('crypto:BTCUSDT');
    await user.click(screen.getByRole('button', { name: 'Open actions for crypto:BTCUSDT' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '1m', pressed: false }));
    await act(async () => {
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/symbols/crypto:BTCUSDT',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
    const patchCall = fetchSpy.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
    );
    expect({
      body: (patchCall?.[1] as RequestInit | undefined)?.body,
      toasted: (toast.success as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    }).toEqual({
      body: JSON.stringify({ periods: ['1m', '1h', '1d'] }),
      toasted: 'Updated periods for crypto:BTCUSDT',
    });
  });

  it('omits a period no longer enabled in config when saving the edit dialog', async () => {
    // BTC watches 1h + 1d, but config now only enables 1h (1d removed in settings).
    let watchlist: EnrichedSymbol[] = [BTC];
    onRequest('GET', '/symbols?enrich=true', () => watchlist);
    onRequest('GET', '/config', () => ({
      periods: [Period.OneHour],
      defaultPeriod: Period.OneHour,
    }));
    onRequest(
      'PATCH',
      '/symbols/crypto:BTCUSDT',
      () => {
        watchlist = [{ ...BTC, periods: [Period.OneHour] }];
        return { ...BTC, periods: [Period.OneHour] };
      },
      200,
    );
    renderPage();
    const user = userEvent.setup();

    await screen.findByText('crypto:BTCUSDT');
    await user.click(screen.getByRole('button', { name: 'Open actions for crypto:BTCUSDT' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    // The disabled 1d isn't offered as a toggle, so it can't be left selected.
    const oneDayOffered = within(dialog).queryByRole('button', { name: '1d' });
    await act(async () => {
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/symbols/crypto:BTCUSDT',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
    const patchCall = fetchSpy.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
    );
    expect({
      oneDayOffered,
      body: (patchCall?.[1] as RequestInit | undefined)?.body,
    }).toEqual({
      oneDayOffered: null,
      body: JSON.stringify({ periods: ['1h'] }),
    });
  });

  it('removes a symbol via the confirm dialog and refetches the list', async () => {
    let watchlist: EnrichedSymbol[] = [BTC, ETH];
    onRequest('GET', '/symbols?enrich=true', () => watchlist);
    onRequest('GET', '/config', () => CONFIG);
    onRequest(
      'DELETE',
      '/symbols/crypto:ETHUSDT',
      () => {
        watchlist = [BTC];
        return null;
      },
      204,
    );
    renderPage();
    const user = userEvent.setup();

    await screen.findByText('crypto:ETHUSDT');
    await user.click(screen.getByRole('button', { name: 'Open actions for crypto:ETHUSDT' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    await act(async () => {
      await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    });

    await waitFor(() => expect(screen.queryByText('crypto:ETHUSDT')).toEqual(null));
    expect({
      deleteUrl: fetchSpy.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === 'DELETE',
      )?.[0],
      toasted: (toast.success as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    }).toEqual({
      deleteUrl: '/api/symbols/crypto:ETHUSDT',
      toasted: 'Removed crypto:ETHUSDT',
    });
  });

  it('surfaces a failed mutation as an error toast and leaves the list unchanged', async () => {
    onRequest('GET', '/symbols?enrich=true', () => [BTC]);
    onRequest('GET', '/config', () => CONFIG);
    onRequest(
      'DELETE',
      '/symbols/crypto:BTCUSDT',
      () => ({ error: 'symbol has an active job' }),
      400,
    );
    renderPage();
    const user = userEvent.setup();

    await screen.findByText('crypto:BTCUSDT');
    await user.click(screen.getByRole('button', { name: 'Open actions for crypto:BTCUSDT' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    await act(async () => {
      await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    });

    await waitFor(() => {
      expect(toast.error as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
        'symbol has an active job',
      );
    });
    expect(screen.getByText('crypto:BTCUSDT')).toBeInTheDocument();
  });

  it("links each row's symbol id to the chart page without pinning a period", async () => {
    onRequest('GET', '/symbols?enrich=true', () => [BTC]);
    onRequest('GET', '/config', () => CONFIG);
    renderPage();

    const symbolLink = await screen.findByRole('link', { name: 'crypto:BTCUSDT' });

    // No period in the link — the chart resolves the persisted period (then default).
    expect(symbolLink.getAttribute('href')).toEqual('/chart?id=crypto%3ABTCUSDT');
  });
});
