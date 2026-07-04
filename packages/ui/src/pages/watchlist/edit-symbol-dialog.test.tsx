// @vitest-environment jsdom
import { Period, SymbolType } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditSymbolDialog } from './edit-symbol-dialog';

/**
 * Edit-symbol dialog tests — focus on the re-seed invariant: opening the dialog
 * seeds the period toggles from the symbol's watched periods, but only those the
 * platform config still offers (a watched-but-disabled period is dropped so the
 * next save heals the symbol to a valid set).
 *
 * `sonner` is mocked at module level so the save-path toast import doesn't pull
 * in the real `<Toaster />`.
 */
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

const BTC_ID = 'crypto:BTCUSDT';

/** Wrap a dialog in the providers it needs: a fresh QueryClient and the Radix Theme. */
function renderInProviders(ui: ReactNode): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Theme>{ui}</Theme>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('EditSymbolDialog', () => {
  it('seeds only the still-offered periods when a watched period is no longer enabled in config', () => {
    renderInProviders(
      <EditSymbolDialog
        id={BTC_ID}
        type={SymbolType.Crypto}
        periods={[Period.OneHour, Period.OneDay]}
        availablePeriods={[Period.OneHour]}
        open={true}
        onOpenChange={() => {}}
      />,
    );

    expect({
      oneHour: screen.getByRole('button', { name: '1h' }).getAttribute('aria-pressed'),
      oneDayRendered: screen.queryByRole('button', { name: '1d' }) !== null,
    }).toEqual({ oneHour: 'true', oneDayRendered: false });
  });

  it('seeds every watched period as pressed and leaves the other offered periods unpressed', () => {
    renderInProviders(
      <EditSymbolDialog
        id={BTC_ID}
        type={SymbolType.Crypto}
        periods={[Period.OneHour, Period.OneDay]}
        availablePeriods={[Period.OneMinute, Period.OneHour, Period.OneDay]}
        open={true}
        onOpenChange={() => {}}
      />,
    );

    expect({
      oneMinute: screen.getByRole('button', { name: '1m' }).getAttribute('aria-pressed'),
      oneHour: screen.getByRole('button', { name: '1h' }).getAttribute('aria-pressed'),
      oneDay: screen.getByRole('button', { name: '1d' }).getAttribute('aria-pressed'),
    }).toEqual({ oneMinute: 'false', oneHour: 'true', oneDay: 'true' });
  });
});
