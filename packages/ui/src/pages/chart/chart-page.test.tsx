// @vitest-environment jsdom
import {
  type Candle,
  type Config,
  type EnrichedSymbol,
  FieldType,
  type IndicatorComputeResult,
  type IndicatorDefinition,
  type IndicatorInstance,
  Pane,
  Period,
  PriceSource,
  type Profile,
  ProfileScope,
  RenderKind,
  SymbolType,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SELECTED_PROFILE_STORAGE_KEY } from '../../lib/selected-profile.js';
import { SelectedProfileProvider } from '../../lib/selected-profile-context.js';
import { ThemeProvider } from '../../lib/theme-context.js';

// The canvas wrapper is mocked — page tests assert data/URL/state, not pixels.
// Its `onLiveCandle` (the forming bar the chart applies) is captured so a test
// can report a live/folded bar and assert the page reacts (e.g. the tab title).
const { chartMock } = vi.hoisted(() => ({
  chartMock: { onLiveCandle: null as ((candle: unknown) => void) | null },
}));
vi.mock('./candle-chart.js', () => ({
  CandleChart: (props: { onLiveCandle?: (candle: unknown) => void }) => {
    chartMock.onLiveCandle = props.onLiveCandle ?? null;
    return <div>candle-chart</div>;
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
// The chart subscribes to the live candle stream; stub the shared client so the
// page tests don't open a (jsdom-absent) WebSocket. Subscribers are captured so
// a test can emit a live frame (e.g. a fresh candle bar).
const { streamSubs } = vi.hoisted(() => ({
  streamSubs: [] as Array<{ kind: string; key: unknown; cb: (event: unknown) => void }>,
}));
vi.mock('../../lib/stream/stream-client.js', () => ({
  streamClient: {
    subscribe: (kind: string, key: unknown, cb: (event: unknown) => void) => {
      streamSubs.push({ kind, key, cb });
      return () => {};
    },
    onReconnect: () => () => {},
  },
}));

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
    streamSubs.length = 0;
    chartMock.onLiveCandle = null;
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
    window.localStorage.clear();
  });

  function onRequest(includes: string, body: () => unknown): void {
    matchers.push({ includes, body });
  }

  function renderAt(path: string): void {
    render(
      <QueryClientProvider client={queryClient}>
        <Theme>
          <ThemeProvider>
            <SelectedProfileProvider>
              <MemoryRouter initialEntries={[path]}>
                <LocationProbe />
                <Routes>
                  <Route path="/" element={<div>watchlist-home</div>} />
                  <Route path="/chart" element={<ChartPage />} />
                </Routes>
              </MemoryRouter>
            </SelectedProfileProvider>
          </ThemeProvider>
        </Theme>
      </QueryClientProvider>,
    );
  }

  it('redirects bare /chart to the first watched symbol on the default period', async () => {
    onRequest('/symbols?enrich=true', () => [BTC]);
    onRequest('/config', () => CONFIG);
    onRequest('/candles', () => ({ candles: [], nextCursor: null }));
    onRequest('/profiles', () => []);
    onRequest('/indicators', () => []);

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
    onRequest('/profiles', () => []);
    onRequest('/indicators', () => []);
    onRequest('/rule-events/count', () => ({ count: 0 }));
    onRequest('/rules?', () => []);

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
    onRequest('/profiles', () => []);
    onRequest('/indicators', () => []);
    onRequest('/rule-events/count', () => ({ count: 0 }));
    onRequest('/rules?', () => []);
    // Latest close 102 vs previous close 100 → +2.00 (+2.00%), on the charted 1h.
    onRequest('/candles', () => ({
      candles: [candle(1000, 100), candle(2000, 102)],
      nextCursor: null,
    }));

    renderAt('/chart?id=crypto:BTCUSDT&period=1h');

    // Wait for the chart body (mock) to render, which means candles have loaded.
    await screen.findByText('candle-chart');

    expect(document.title).toEqual('crypto:BTCUSDT 102.00 ▲ +2.00% (2.00) - lametrader');
  });

  it("updates document.title from the chart's live forming bar (e.g. a coarser period's folded bar)", async () => {
    onRequest('/symbols?enrich=true', () => [BTC]);
    onRequest('/config', () => CONFIG);
    onRequest('/profiles', () => []);
    onRequest('/indicators', () => []);
    onRequest('/rule-events/count', () => ({ count: 0 }));
    onRequest('/rules?', () => []);
    onRequest('/candles', () => ({
      candles: [candle(1000, 100), candle(2000, 102)],
      nextCursor: null,
    }));

    renderAt('/chart?id=crypto:BTCUSDT&period=1h');
    await screen.findByText('candle-chart');

    // The chart reports the forming bar it applies (a folded finer frame on a
    // coarser period, or the period's own frame) for the newest bucket (time
    // 2000) — the title follows it: close 110 vs the previous bar's 100 →
    // +10.00 (+10.00%).
    act(() => chartMock.onLiveCandle?.(candle(2000, 110)));

    expect(document.title).toEqual('crypto:BTCUSDT 110.00 ▲ +10.00% (10.00) - lametrader');
  });

  it('redirects bare /chart to the last-selected period from storage when one is saved', async () => {
    window.localStorage.setItem('chart-period', '1h');
    onRequest('/symbols?enrich=true', () => [BTC]);
    onRequest('/config', () => CONFIG);
    onRequest('/candles', () => ({ candles: [], nextCursor: null }));
    onRequest('/profiles', () => []);
    onRequest('/indicators', () => []);

    renderAt('/chart');

    // Config default is 1d, but the stored 1h (still enabled) wins.
    await screen.findByText(`at:/chart?${new URLSearchParams({ id: BTC.id, period: '1h' })}`);
    expect(
      screen.queryByText(`at:/chart?${new URLSearchParams({ id: BTC.id, period: '1h' })}`),
    ).not.toBeNull();
  });

  const SCALPER: Profile = {
    id: 'p-1',
    name: 'Scalper',
    description: '',
    enabled: true,
    scope: { type: ProfileScope.All },
    createdAt: 1,
    updatedAt: 1,
    indicators: [],
  };
  const DISABLED_PROFILE: Profile = {
    id: 'p-0',
    name: 'Retired',
    description: '',
    enabled: false,
    scope: { type: ProfileScope.All },
    createdAt: 1,
    updatedAt: 1,
    indicators: [],
  };

  it('hosts the profile picker trigger in the bottom-bar Chart actions group', async () => {
    onRequest('/symbols?enrich=true', () => [BTC]);
    onRequest('/config', () => CONFIG);
    onRequest('/candles', () => ({ candles: [], nextCursor: null }));
    onRequest('/profiles', () => [SCALPER]);
    onRequest('/indicators', () => []);
    onRequest('/rule-events/count', () => ({ count: 0 }));
    onRequest('/rules?', () => []);

    renderAt('/chart?id=crypto:BTCUSDT&period=1h');

    const actions = await screen.findByRole('group', { name: 'Chart actions' });
    await waitFor(() =>
      expect(within(actions).queryByRole('button', { name: SCALPER.name })).not.toBeNull(),
    );
  });

  it("hosts the indicator-panel trigger in the bottom-bar Chart actions group, labeled with the selected profile's instance count", async () => {
    onRequest('/symbols?enrich=true', () => [BTC]);
    onRequest('/config', () => CONFIG);
    onRequest('/candles', () => ({ candles: [], nextCursor: null }));
    onRequest('/profiles', () => [SCALPER]);
    onRequest('/indicators', () => []);
    onRequest('/rule-events/count', () => ({ count: 0 }));
    onRequest('/rules?', () => []);

    renderAt('/chart?id=crypto:BTCUSDT&period=1h');

    const actions = await screen.findByRole('group', { name: 'Chart actions' });
    await waitFor(() =>
      expect(within(actions).queryByRole('button', { name: 'Indicators (0)' })).not.toBeNull(),
    );
  });

  it('hosts the Rules trigger in the bottom-bar Chart actions group, labeled with the symbol-scoped rule count', async () => {
    onRequest('/symbols?enrich=true', () => [BTC]);
    onRequest('/config', () => CONFIG);
    onRequest('/candles', () => ({ candles: [], nextCursor: null }));
    onRequest('/profiles', () => [SCALPER]);
    onRequest('/indicators', () => []);
    onRequest('/rule-events/count', () => ({ count: 0 }));
    // Three rules whose scope applies to BTC (Symbol, Symbols-list, AllSymbols).
    onRequest('/rules?', () => [
      { id: 'r-1', name: 'a' },
      { id: 'r-2', name: 'b' },
      { id: 'r-3', name: 'c' },
    ]);

    renderAt('/chart?id=crypto:BTCUSDT&period=1h');

    const actions = await screen.findByRole('group', { name: 'Chart actions' });
    await waitFor(() =>
      expect(within(actions).queryByRole('button', { name: 'Rules (3)' })).not.toBeNull(),
    );
  });

  it('hosts the Events trigger in the bottom-bar Chart actions group, labeled with the symbol-scoped rule-event count', async () => {
    onRequest('/symbols?enrich=true', () => [BTC]);
    onRequest('/config', () => CONFIG);
    onRequest('/candles', () => ({ candles: [], nextCursor: null }));
    onRequest('/profiles', () => [SCALPER]);
    onRequest('/indicators', () => []);
    onRequest('/rule-events/count', () => ({ count: 3 }));

    renderAt('/chart?id=crypto:BTCUSDT&period=1h');

    const actions = await screen.findByRole('group', { name: 'Chart actions' });
    await waitFor(() =>
      expect(within(actions).queryByRole('button', { name: 'Events (3)' })).not.toBeNull(),
    );
  });

  it('caps the Events trigger badge at 99+ when the count exceeds 99', async () => {
    onRequest('/symbols?enrich=true', () => [BTC]);
    onRequest('/config', () => CONFIG);
    onRequest('/candles', () => ({ candles: [], nextCursor: null }));
    onRequest('/profiles', () => [SCALPER]);
    onRequest('/indicators', () => []);
    onRequest('/rule-events/count', () => ({ count: 250 }));

    renderAt('/chart?id=crypto:BTCUSDT&period=1h');

    const actions = await screen.findByRole('group', { name: 'Chart actions' });
    await waitFor(() =>
      expect(within(actions).queryByRole('button', { name: 'Events (99+)' })).not.toBeNull(),
    );
  });

  it('defaults the selection to the first enabled profile on first run and persists it', async () => {
    onRequest('/symbols?enrich=true', () => [BTC]);
    onRequest('/config', () => CONFIG);
    onRequest('/candles', () => ({ candles: [], nextCursor: null }));
    onRequest('/profiles', () => [DISABLED_PROFILE, SCALPER]);
    onRequest('/indicators', () => []);
    onRequest('/rule-events/count', () => ({ count: 0 }));
    onRequest('/rules?', () => []);

    renderAt('/chart?id=crypto:BTCUSDT&period=1h');

    const actions = await screen.findByRole('group', { name: 'Chart actions' });
    await waitFor(() =>
      expect(within(actions).queryByRole('button', { name: SCALPER.name })).not.toBeNull(),
    );
    expect(window.localStorage.getItem(SELECTED_PROFILE_STORAGE_KEY)).toEqual(SCALPER.id);
  });

  it('treats a stored id missing from GET /profiles as "No profile" without wiping the stored value', async () => {
    window.localStorage.setItem(SELECTED_PROFILE_STORAGE_KEY, 'p-stale');
    onRequest('/symbols?enrich=true', () => [BTC]);
    onRequest('/config', () => CONFIG);
    onRequest('/candles', () => ({ candles: [], nextCursor: null }));
    onRequest('/profiles', () => [SCALPER]);
    onRequest('/indicators', () => []);
    onRequest('/rule-events/count', () => ({ count: 0 }));
    onRequest('/rules?', () => []);

    renderAt('/chart?id=crypto:BTCUSDT&period=1h');

    const actions = await screen.findByRole('group', { name: 'Chart actions' });
    await waitFor(() =>
      expect(within(actions).queryByRole('button', { name: 'No profile' })).not.toBeNull(),
    );
    expect(window.localStorage.getItem(SELECTED_PROFILE_STORAGE_KEY)).toEqual('p-stale');
  });

  const SMA_DEFINITION: IndicatorDefinition = {
    key: 'sma',
    name: 'Simple Moving Average',
    description: '',
    version: 1,
    appliesTo: [SymbolType.Crypto, SymbolType.Stock, SymbolType.Fund, SymbolType.Fx],
    inputs: [
      { type: FieldType.Number, key: 'length', label: 'Length', default: 14 },
      { type: FieldType.Source, key: 'source', label: 'Source', default: PriceSource.Close },
    ],
    state: [
      {
        type: FieldType.Number,
        key: 'value',
        label: 'SMA',
        render: RenderKind.Line,
        pane: Pane.Overlay,
      },
    ],
  };

  /** A crypto-only definition used to assert the n/a-skip on a non-crypto chart. */
  const VWMA_DEFINITION: IndicatorDefinition = {
    key: 'vwma',
    name: 'Volume-Weighted Moving Average',
    description: '',
    version: 1,
    appliesTo: [SymbolType.Crypto],
    inputs: [{ type: FieldType.Number, key: 'length', label: 'Length', default: 20 }],
    state: [
      {
        type: FieldType.Number,
        key: 'value',
        label: 'VWMA',
        render: RenderKind.Line,
        pane: Pane.Overlay,
      },
    ],
  };

  const SMA_INSTANCE: IndicatorInstance = {
    id: 'inst-sma',
    indicatorKey: 'sma',
    version: 1,
    inputs: { length: 14, source: PriceSource.Close },
    summary: 'SMA 14 close',
  };

  const VWMA_INSTANCE: IndicatorInstance = {
    id: 'inst-vwma',
    indicatorKey: 'vwma',
    version: 1,
    inputs: { length: 20 },
    summary: 'VWMA 20',
  };

  /**
   * The chart-page integration tests need the captured request URLs, not just
   * the response bodies — assert which compute calls fired and which didn't.
   */
  /** Compact JSON response — saved a few lines in the multi-route fetch stubs below. */
  function json(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('issues GET /symbols/:id/indicators/:key per applicable instance, carrying from/to from the loaded candle feed', async () => {
    const captured: string[] = [];
    const candles = [candle(1_000_000, 100), candle(2_000_000, 102)];
    const fetchSpy = vi.fn(async (url: string) => {
      captured.push(String(url));
      const u = String(url);
      if (u.includes('/symbols?enrich=true')) return json([BTC]);
      if (u.endsWith('/api/config')) return json(CONFIG);
      if (u.includes('/profiles')) {
        return json([{ ...SCALPER, indicators: [SMA_INSTANCE] }]);
      }
      if (u.endsWith('/api/indicators')) return json([SMA_DEFINITION]);
      if (u.includes('/rule-events/count')) return json({ count: 0 });
      if (u.includes('/rules?')) return json([]);
      if (u.includes('/candles')) return json({ candles, nextCursor: null });
      if (u.includes('/symbols/crypto:BTCUSDT/indicators/sma')) {
        const result: IndicatorComputeResult = {
          indicatorKey: 'sma',
          version: 1,
          period: Period.OneHour,
          state: [{ time: 1_000_000, value: 100 }],
        };
        return json(result);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    renderAt('/chart?id=crypto:BTCUSDT&period=1h');

    await waitFor(() => expect(captured.some((u) => u.includes('/indicators/sma?'))).toEqual(true));
    const computeUrls = captured.filter((u) => u.includes('/indicators/sma?'));
    expect(computeUrls).toEqual([
      '/api/symbols/crypto:BTCUSDT/indicators/sma?period=1h&from=1000000&to=2000001&length=14&source=close',
    ]);
  });

  it('extends the state-overlay window to a live-streamed bar past the loaded feed', async () => {
    // Select the state key 'trend' for the auto-selected profile so the overlay
    // series read fires.
    window.localStorage.setItem(
      'chart-state-overlays::p-1::crypto:BTCUSDT',
      JSON.stringify(['trend']),
    );
    onRequest('/symbols?enrich=true', () => [BTC]);
    onRequest('/config', () => CONFIG);
    onRequest('/profiles', () => [SCALPER]);
    onRequest('/indicators', () => []);
    onRequest('/candles', () => ({
      candles: [candle(1_000_000, 100), candle(2_000_000, 102)],
      nextCursor: null,
    }));
    onRequest('/rules?', () => []);
    onRequest('/rule-events/count', () => ({ count: 0 }));
    onRequest('/state-keys', () => [{ key: 'trend', valueType: 'number' }]);
    onRequest('/state/trend/series', () => []);

    renderAt('/chart?id=crypto:BTCUSDT&period=1h');

    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    // Initial window: bounded by the last loaded candle (2_000_000 + 1).
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some((c) =>
          String(c[0]).includes('/state/trend/series?from=1000000&to=2000001'),
        ),
      ).toEqual(true),
    );

    // A fresh bar arrives on the live candle feed, past the loaded feed's tail.
    const candleSub = streamSubs.find((s) => s.kind === 'candle' && s.key === 'crypto:BTCUSDT');
    act(() =>
      candleSub?.cb({
        id: 'crypto:BTCUSDT',
        period: Period.OneHour,
        candle: candle(3_000_000, 105),
        final: false,
      }),
    );

    // The window now reaches the live bar (3_000_000 + 1) so a state set on the
    // fresh bar lands in the series and its value marker renders.
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some((c) =>
          String(c[0]).includes('/state/trend/series?from=1000000&to=3000001'),
        ),
      ).toEqual(true),
    );
  });

  it('issues no compute call until the candle feed has loaded a window — closes the full-history race', async () => {
    // Profile + catalog resolve first; candles are still empty. Without the
    // explicit gate, the compute call would fire with no `from`/`to` and the
    // engine would fall back to a full-history scan.
    const captured: string[] = [];
    const fetchSpy = vi.fn(async (url: string) => {
      captured.push(String(url));
      const u = String(url);
      if (u.includes('/symbols?enrich=true')) return json([BTC]);
      if (u.endsWith('/api/config')) return json(CONFIG);
      if (u.includes('/profiles')) {
        return json([{ ...SCALPER, indicators: [SMA_INSTANCE] }]);
      }
      if (u.endsWith('/api/indicators')) return json([SMA_DEFINITION]);
      if (u.includes('/rule-events/count')) return json({ count: 0 });
      if (u.includes('/rules?')) return json([]);
      if (u.includes('/candles')) return json({ candles: [], nextCursor: null });
      throw new Error(`unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    renderAt('/chart?id=crypto:BTCUSDT&period=1h');

    await screen.findByRole('group', { name: 'Chart actions' });
    await waitFor(() => expect(captured.some((u) => u.endsWith('/api/indicators'))).toEqual(true));
    const computeUrls = captured.filter((u) => u.includes('/indicators/sma?'));
    expect(computeUrls).toEqual([]);
  });

  it('skips the compute call for an instance whose definition does not apply to the chart symbol type', async () => {
    const FX: EnrichedSymbol = {
      id: 'fx:EURUSD',
      type: SymbolType.Fx,
      description: 'EUR / USD',
      exchange: 'FX',
      currency: 'USD',
      periods: [Period.OneHour],
      quote: null,
    };
    const captured: string[] = [];
    const fetchSpy = vi.fn(async (url: string) => {
      captured.push(String(url));
      const u = String(url);
      if (u.includes('/symbols?enrich=true')) return json([FX]);
      if (u.endsWith('/api/config')) return json(CONFIG);
      if (u.includes('/profiles')) {
        return json([{ ...SCALPER, indicators: [VWMA_INSTANCE] }]);
      }
      if (u.endsWith('/api/indicators')) return json([VWMA_DEFINITION]);
      if (u.includes('/rule-events/count')) return json({ count: 0 });
      if (u.includes('/rules?')) return json([]);
      if (u.includes('/candles')) return json({ candles: [], nextCursor: null });
      throw new Error(`unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    renderAt('/chart?id=fx:EURUSD&period=1h');

    // Wait for the page to settle (profile + catalog + candles all loaded);
    // any compute call would already have fired by then.
    await screen.findByRole('group', { name: 'Chart actions' });
    await waitFor(() => expect(captured.some((u) => u.endsWith('/api/indicators'))).toEqual(true));
    const computeUrls = captured.filter((u) => u.includes('/indicators/vwma?'));
    expect(computeUrls).toEqual([]);
  });

  it('persists the selected period to localStorage when applied', async () => {
    onRequest('/symbols?enrich=true', () => [BTC]);
    onRequest('/config', () => CONFIG);
    onRequest('/profiles', () => []);
    onRequest('/indicators', () => []);
    onRequest('/candles', () => ({ candles: [], nextCursor: null }));
    onRequest('/rule-events/count', () => ({ count: 0 }));
    onRequest('/rules?', () => []);
    renderAt('/chart?id=crypto:BTCUSDT&period=1h');
    const user = userEvent.setup();

    // Open the period dialog (bottom-bar trigger is labeled with the current period).
    await user.click(await screen.findByRole('button', { name: '1h' }));
    await user.click(await screen.findByRole('button', { name: '1d' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(window.localStorage.getItem('chart-period')).toEqual('1d');
  });
});
