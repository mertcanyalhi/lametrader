// @vitest-environment jsdom
import {
  type Config,
  type EnrichedSymbol,
  Period,
  type Profile,
  ProfileScope,
  SymbolType,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelectedProfileProvider } from '../../lib/selected-profile-context.js';
import { ThemeProvider } from '../../lib/theme-context.js';
import { BacktestingPage } from './backtesting-page.js';

const BTC: EnrichedSymbol = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'BTC / USDT',
  exchange: 'Binance',
  currency: 'USDT',
  periods: [Period.OneHour, Period.OneDay],
  quote: { price: 50000, change: 100, changePct: 0.002, period: Period.OneDay, time: 1000 },
};

const ETH: EnrichedSymbol = {
  id: 'crypto:ETHUSDT',
  type: SymbolType.Crypto,
  description: 'ETH / USDT',
  exchange: 'Binance',
  currency: 'USDT',
  periods: [Period.OneHour, Period.OneDay],
  quote: { price: 3000, change: 10, changePct: 0.003, period: Period.OneDay, time: 1000 },
};

const CONFIG: Config = {
  periods: [Period.OneHour, Period.FourHours, Period.OneDay],
  defaultPeriod: Period.OneDay,
};

const ALPHA: Profile = {
  id: 'p-alpha',
  name: 'Alpha',
  description: '',
  enabled: true,
  scope: { type: ProfileScope.All },
  createdAt: 1,
  updatedAt: 1,
  indicators: [],
};

const BETA: Profile = {
  id: 'p-beta',
  name: 'Beta',
  description: '',
  enabled: true,
  scope: { type: ProfileScope.All },
  createdAt: 2,
  updatedAt: 2,
  indicators: [],
};

describe('BacktestingPage', () => {
  let queryClient: QueryClient;
  let matchers: Array<{ includes: string; body: () => unknown }>;

  beforeEach(() => {
    matchers = [];
    // The panel's strategy manager lists strategies on mount; default it to an
    // empty list so the pre-existing picker tests don't hit an unexpected fetch.
    matchers.push({ includes: '/backtest-strategies', body: () => [] });
    // The layout discovers any active run on mount (reattach); default it to none
    // so the picker tests start idle with unlocked pickers.
    matchers.push({ includes: '/backtests?status=', body: () => [] });
    const fetchSpy = vi.fn(async (url: string) => {
      const match = matchers.find((m) => String(url).includes(m.includes));
      if (!match) throw new Error(`unexpected fetch: ${url}`);
      return new Response(JSON.stringify(match.body()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  function onRequest(includes: string, body: () => unknown): void {
    matchers.push({ includes, body });
  }

  function renderPage(): void {
    render(
      <QueryClientProvider client={queryClient}>
        <Theme>
          <ThemeProvider>
            <SelectedProfileProvider>
              <MemoryRouter initialEntries={['/backtesting']}>
                <BacktestingPage />
              </MemoryRouter>
            </SelectedProfileProvider>
          </ThemeProvider>
        </Theme>
      </QueryClientProvider>,
    );
  }

  it('renders the chart region, the panel region, and the empty-chart placeholder', async () => {
    onRequest('/symbols?enrich=true', () => [BTC]);
    onRequest('/config', () => CONFIG);
    onRequest('/profiles', () => [ALPHA]);

    renderPage();

    const chart = await screen.findByRole('region', { name: 'Backtest chart' });
    const panel = screen.getByRole('region', { name: 'Backtest panel' });
    expect({
      chartHasPlaceholder: within(chart).queryByText(/run a backtest to see the chart/i) !== null,
      panelPresent: panel !== null,
    }).toEqual({ chartHasPlaceholder: true, panelPresent: true });
  });

  it('hosts the symbol, profile, and period pickers in the bottom action bar', async () => {
    onRequest('/symbols?enrich=true', () => [BTC]);
    onRequest('/config', () => CONFIG);
    onRequest('/profiles', () => [ALPHA]);

    renderPage();

    const bar = await screen.findByRole('group', { name: 'Backtesting actions' });
    // The profile trigger fills once the picker's auto-select effect resolves.
    await waitFor(() => {
      expect(within(bar).queryByRole('button', { name: 'Alpha' })).not.toBeNull();
    });
    expect({
      symbol: within(bar).queryByRole('button', { name: BTC.id }) !== null,
      period: within(bar).queryByRole('button', { name: Period.OneDay }) !== null,
      profile: within(bar).queryByRole('button', { name: 'Alpha' }) !== null,
    }).toEqual({ symbol: true, period: true, profile: true });
  });

  it('hosts the previous-runs trigger in the bottom action bar', async () => {
    onRequest('/symbols?enrich=true', () => [BTC]);
    onRequest('/config', () => CONFIG);
    onRequest('/profiles', () => [ALPHA]);

    renderPage();

    const bar = await screen.findByRole('group', { name: 'Backtesting actions' });
    // The count query resolves to the default empty saved-backtests list.
    await waitFor(() => {
      expect(within(bar).queryByRole('button', { name: 'Previous runs (0)' })).not.toBeNull();
    });
    expect(within(bar).queryByRole('button', { name: 'Previous runs (0)' }) !== null).toEqual(true);
  });

  it('updates the selected symbol in the picker when a watched symbol is picked', async () => {
    onRequest('/symbols?enrich=true', () => [BTC, ETH]);
    onRequest('/config', () => CONFIG);
    onRequest('/profiles', () => [ALPHA]);
    const user = userEvent.setup();

    renderPage();

    const bar = await screen.findByRole('group', { name: 'Backtesting actions' });
    await user.click(within(bar).getByRole('button', { name: BTC.id }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: ETH.id }));

    await waitFor(() => {
      expect(within(bar).queryByRole('button', { name: ETH.id })).not.toBeNull();
    });
    expect({
      selected: within(bar).queryByRole('button', { name: ETH.id }) !== null,
      chartStillEmpty: screen.queryByText(/run a backtest to see the chart/i) !== null,
    }).toEqual({ selected: true, chartStillEmpty: true });
  });

  it('updates the selected period in the picker when a watched period is applied', async () => {
    onRequest('/symbols?enrich=true', () => [BTC]);
    onRequest('/config', () => CONFIG);
    onRequest('/profiles', () => [ALPHA]);
    const user = userEvent.setup();

    renderPage();

    const bar = await screen.findByRole('group', { name: 'Backtesting actions' });
    await user.click(within(bar).getByRole('button', { name: Period.OneDay }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: Period.OneHour }));
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(within(bar).queryByRole('button', { name: Period.OneHour })).not.toBeNull();
    });
    expect(within(bar).queryByRole('button', { name: Period.OneHour }) !== null).toEqual(true);
  });

  it('updates the selected profile in the picker when another profile is picked', async () => {
    onRequest('/symbols?enrich=true', () => [BTC]);
    onRequest('/config', () => CONFIG);
    onRequest('/profiles', () => [ALPHA, BETA]);
    const user = userEvent.setup();

    renderPage();

    const bar = await screen.findByRole('group', { name: 'Backtesting actions' });
    // The picker auto-selects the first enabled profile (Alpha) on mount.
    await waitFor(() => {
      expect(within(bar).queryByRole('button', { name: 'Alpha' })).not.toBeNull();
    });
    await user.click(within(bar).getByRole('button', { name: 'Alpha' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Select Beta' }));

    await waitFor(() => {
      expect(within(bar).queryByRole('button', { name: 'Beta' })).not.toBeNull();
    });
    expect(within(bar).queryByRole('button', { name: 'Beta' }) !== null).toEqual(true);
  });

  it('renders the page even when the watchlist is empty', async () => {
    onRequest('/symbols?enrich=true', () => []);
    onRequest('/config', () => CONFIG);
    onRequest('/profiles', () => []);

    renderPage();

    const chart = await screen.findByRole('region', { name: 'Backtest chart' });
    expect(within(chart).queryByText(/run a backtest to see the chart/i) !== null).toEqual(true);
  });
});
