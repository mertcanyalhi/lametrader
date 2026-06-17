// @vitest-environment jsdom
import {
  type Candle,
  type Config,
  type EnrichedSymbol,
  Period,
  SymbolType,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The canvas wrapper is mocked — page tests assert data/URL/state, not pixels.
vi.mock('./candle-chart.js', () => ({ CandleChart: () => <div>candle-chart</div> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));

import { ChartPage } from './chart-page.js';

const BTC: EnrichedSymbol = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'BTC / USDT',
  exchange: 'Binance',
  currency: 'USDT',
  periods: [Period.OneHour, Period.OneDay],
  quote: { price: 50000, change: 100, changePct: 0.002, period: Period.OneDay, time: 1000 },
};

const CONFIG: Config = {
  periods: [Period.OneHour, Period.FourHours, Period.OneDay],
  defaultPeriod: Period.OneDay,
};

/** Build a crypto candle closing at `close`, at `time`. */
const candle = (time: number, close: number): Candle => ({
  type: SymbolType.Crypto,
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 10,
  quoteVolume: 10,
  trades: 1,
});

/** Renders the current location so a redirect's target can be asserted. */
function LocationProbe(): ReactNode {
  const loc = useLocation();
  return <div>{`at:${loc.pathname}${loc.search}`}</div>;
}

describe('ChartPage', () => {
  let queryClient: QueryClient;
  let matchers: Array<{ includes: string; body: () => unknown }>;

  beforeEach(() => {
    matchers = [];
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
  });

  function onRequest(includes: string, body: () => unknown): void {
    matchers.push({ includes, body });
  }

  function renderAt(path: string): void {
    render(
      <QueryClientProvider client={queryClient}>
        <Theme>
          <MemoryRouter initialEntries={[path]}>
            <LocationProbe />
            <Routes>
              <Route path="/" element={<div>watchlist-home</div>} />
              <Route path="/chart" element={<ChartPage />} />
            </Routes>
          </MemoryRouter>
        </Theme>
      </QueryClientProvider>,
    );
  }

  it('redirects bare /chart to the first watched symbol on the default period', async () => {
    onRequest('/symbols?enrich=true', () => [BTC]);
    onRequest('/config', () => CONFIG);
    onRequest('/candles', () => ({ candles: [], nextCursor: null }));

    renderAt('/chart');

    await screen.findByText(`at:/chart?${new URLSearchParams({ id: BTC.id, period: '1d' })}`);
    expect(
      screen.queryByText(`at:/chart?${new URLSearchParams({ id: BTC.id, period: '1d' })}`),
    ).not.toBeNull();
  });

  it('redirects bare /chart to the watchlist when nothing is watched', async () => {
    onRequest('/symbols?enrich=true', () => []);
    onRequest('/config', () => CONFIG);

    renderAt('/chart');

    await screen.findByText('watchlist-home');
    expect(screen.queryByText('watchlist-home')).not.toBeNull();
  });

  it('shows a "not watched" hint instead of the chart when the period is not in the symbol', async () => {
    onRequest('/symbols?enrich=true', () => [BTC]);
    onRequest('/config', () => CONFIG);

    renderAt('/chart?id=crypto:BTCUSDT&period=4h');

    await screen.findByRole('link', { name: /watchlist/i });
    expect({
      hint: screen.queryByText(/not watched/i) !== null,
      chartShown: screen.queryByText('candle-chart') !== null,
    }).toEqual({ hint: true, chartShown: false });
  });

  it("reflects the latest loaded candle's close and change (current period) in document.title", async () => {
    onRequest('/symbols?enrich=true', () => [BTC]);
    onRequest('/config', () => CONFIG);
    // Latest close 102 vs previous close 100 → +2.00 (+2.00%), on the charted 1h.
    onRequest('/candles', () => ({
      candles: [candle(1000, 100), candle(2000, 102)],
      nextCursor: null,
    }));

    renderAt('/chart?id=crypto:BTCUSDT&period=1h');

    // Wait for the chart body (mock) to render, which means candles have loaded.
    await screen.findByText('candle-chart');

    expect(document.title).toEqual('crypto:BTCUSDT · 102.00 +2.00 (+2.00%) - lametrader');
  });
});
