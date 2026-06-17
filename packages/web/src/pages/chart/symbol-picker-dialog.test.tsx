// @vitest-environment jsdom
import { type EnrichedSymbol, type Instrument, Period, SymbolType } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SymbolPickerDialog } from './symbol-picker-dialog.js';

const BTC: EnrichedSymbol = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'BTC / USDT',
  exchange: 'Binance',
  currency: 'USDT',
  periods: [Period.OneHour],
  quote: null,
};

const ETH: EnrichedSymbol = {
  id: 'crypto:ETHUSDT',
  type: SymbolType.Crypto,
  description: 'ETH / USDT',
  exchange: 'Binance',
  currency: 'USDT',
  periods: [Period.OneHour],
  quote: null,
};

/** A catalog hit that is *not* in the watchlist — should render faded with a popover on click. */
const SOL: Instrument = {
  id: 'crypto:SOLUSDT',
  type: SymbolType.Crypto,
  description: 'SOL / USDT',
  exchange: 'Binance',
  currency: 'USDT',
};

describe('SymbolPickerDialog', () => {
  let queryClient: QueryClient;
  let selected: string[];

  beforeEach(() => {
    selected = [];
    globalThis.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/instruments?')) {
        return new Response(JSON.stringify([BTC, ETH, SOL]), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function renderPicker(): void {
    render(
      <QueryClientProvider client={queryClient}>
        <Theme>
          <SymbolPickerDialog
            currentId={BTC.id}
            watched={[BTC, ETH]}
            onSelect={(id) => selected.push(id)}
          />
        </Theme>
      </QueryClientProvider>,
    );
  }

  it('opens the dialog and lists the watched symbols when no search is active', async () => {
    renderPicker();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: BTC.id }));

    expect({
      ethPresent: screen.queryByRole('button', { name: new RegExp(ETH.id, 'i') }) !== null,
      btcPresent: screen.queryAllByRole('button', { name: new RegExp(BTC.id, 'i') }).length > 0,
      solPresent: screen.queryByRole('button', { name: new RegExp(SOL.id, 'i') }) !== null,
    }).toEqual({ ethPresent: true, btcPresent: true, solPresent: false });
  });

  it('selecting a watched result invokes onSelect with its id and closes the dialog', async () => {
    renderPicker();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: BTC.id }));
    await user.click(await screen.findByRole('button', { name: new RegExp(ETH.id, 'i') }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(selected).toEqual([ETH.id]);
  });

  it('renders search results outside the watchlist faded and shows a popover on click (no selection)', async () => {
    renderPicker();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: BTC.id }));
    await user.type(await screen.findByRole('textbox', { name: 'Search instruments' }), 'sol');
    const solItem = await screen.findByRole('button', { name: new RegExp(SOL.id, 'i') });
    await user.click(solItem);

    expect({
      faded: solItem.getAttribute('data-watched'),
      popover: (await screen.findByText('Symbol is not in the watchlist')).textContent,
      noSelection: selected,
    }).toEqual({
      faded: 'false',
      popover: 'Symbol is not in the watchlist',
      noSelection: [],
    });
  });
});
