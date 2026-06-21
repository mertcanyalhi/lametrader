// @vitest-environment jsdom
import { type Instrument, Period, SymbolType } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Add-symbol dialog tests — focus on the add → backfill handoff: after the add
 * mutation succeeds, the dialog closes and hands the new symbol off to the
 * backfill modal.
 *
 * The symbols hooks are mocked so the test drives the dialog's own logic without
 * a `fetch` boundary; `sonner` is mocked so the success toast is observable.
 */
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

const BTC_ID = 'crypto:BTCUSDT';

const BTC_INSTRUMENT: Instrument = {
  id: BTC_ID,
  type: SymbolType.Crypto,
  description: 'Bitcoin',
  exchange: 'Binance',
  currency: 'USDT',
};

const { mutateAsync } = vi.hoisted(() => ({
  // Inlined literals: `vi.hoisted` runs before the module consts/imports above.
  mutateAsync: vi.fn().mockResolvedValue({ id: 'crypto:BTCUSDT', periods: ['1h'] }),
}));

vi.mock('../../lib/hooks/symbols.js', () => ({
  WATCHLIST_QUERY_KEY: ['watchlist'],
  useSearchInstruments: () => ({ data: [BTC_INSTRUMENT], isFetching: false }),
  useAddSymbol: () => ({ mutateAsync, isPending: false }),
}));

/** Wrap the dialog in the providers it needs: a fresh QueryClient and the Radix Theme. */
function renderInProviders(ui: ReactNode): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Theme>{ui}</Theme>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  mutateAsync.mockClear();
  cleanup();
});

describe('AddSymbolDialog', () => {
  it('adds the selected instrument and hands off to the backfill modal', async () => {
    const { AddSymbolDialog } = await import('./add-symbol-dialog');
    const user = userEvent.setup();
    renderInProviders(
      <AddSymbolDialog triggerLabel="Add symbol" defaultPeriods={[Period.OneHour]} />,
    );

    await user.click(screen.getByRole('button', { name: 'Add symbol' }));
    await user.type(screen.getByRole('textbox', { name: 'Search instruments' }), 'btc');
    await user.click(await screen.findByRole('radio', { name: /Bitcoin/ }));
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Backfill history' })).toBeInTheDocument();
    });
    expect(mutateAsync.mock.calls).toEqual([[{ id: BTC_ID, periods: [Period.OneHour] }]]);
  });
});
