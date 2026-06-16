// @vitest-environment jsdom
import { type EnrichedSymbol, Period, SymbolType } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation, useSearchParams } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { ChartToolbar } from './chart-toolbar.js';

const BTC: EnrichedSymbol = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'BTC / USDT',
  exchange: 'Binance',
  currency: 'USDT',
  periods: [Period.OneHour, Period.OneDay],
  quote: { price: 50000, change: 1234.5, changePct: 0.025, period: Period.OneHour, time: 1000 },
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
const SYMBOLS = [BTC, ETH];

/** Mirrors how the page drives the toolbar: derive id/period from the URL. */
function Harness(): ReactNode {
  const [params] = useSearchParams();
  const id = params.get('id') ?? BTC.id;
  const period = (params.get('period') as Period | null) ?? Period.OneHour;
  const loc = useLocation();
  return (
    <>
      <ChartToolbar symbols={SYMBOLS} id={id} period={period} />
      <span>loc:{loc.search}</span>
    </>
  );
}

function renderToolbar(initial = '/chart?id=crypto:BTCUSDT&period=1h'): void {
  render(
    <Theme>
      <MemoryRouter initialEntries={[initial]}>
        <Harness />
      </MemoryRouter>
    </Theme>,
  );
}

const locText = (): string => screen.getByText(/^loc:/).textContent ?? '';

describe('ChartToolbar', () => {
  afterEach(() => cleanup());

  it('updates the URL id (keeping the period) when another symbol is selected', async () => {
    const user = userEvent.setup();
    renderToolbar();

    await user.click(screen.getByRole('combobox', { name: 'Symbol' }));
    await user.click(await screen.findByRole('option', { name: ETH.id }));

    expect(locText()).toEqual(`loc:?${new URLSearchParams({ id: ETH.id, period: '1h' })}`);
  });

  it('updates the URL period (keeping the symbol) when a watched period is selected', async () => {
    const user = userEvent.setup();
    renderToolbar();

    await user.click(screen.getByRole('button', { name: '1d' }));

    expect(locText()).toEqual(`loc:?${new URLSearchParams({ id: BTC.id, period: '1d' })}`);
  });

  it('disables a period the symbol does not watch, and selecting it is a no-op', async () => {
    const user = userEvent.setup();
    renderToolbar();
    const before = locText();

    await user.click(screen.getByRole('button', { name: '4h' }));

    expect({
      disabled: screen.getByRole('button', { name: '4h' }).hasAttribute('disabled'),
      unchanged: locText() === before,
    }).toEqual({ disabled: true, unchanged: true });
  });

  it("shows the selected symbol's snapshot price and change in the header", () => {
    renderToolbar();

    expect(screen.getByLabelText('Snapshot').textContent).toEqual('50,000.00+1,234.50 (+2.50%)');
  });
});
