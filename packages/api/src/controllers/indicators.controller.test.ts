import { type Candle, Period, SymbolType, type WatchedSymbol } from '@lametrader/core';
import {
  defaultIndicators,
  IndicatorComputeService,
  type IndicatorRegistry,
  InMemoryCandleRepository,
  InMemoryWatchlistRepository,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { buildAppDeps } from '../testing/app-deps';

/**
 * Build an app whose indicator catalog is the real `defaultIndicators()` registry, so the controller is exercised against the shipped reference modules (`sma`, `vwma`).
 *
 * The compute service is built by `buildAppDeps` from the registry; the catalog-side tests here don't exercise compute, so its default wiring is fine.
 */
function buildApp(registry: IndicatorRegistry = defaultIndicators()) {
  return createApp(buildAppDeps({ indicators: { registry } }));
}

const BTC: WatchedSymbol = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'Bitcoin',
  exchange: 'Binance',
  periods: [Period.OneHour],
};

const EURUSD: WatchedSymbol = {
  id: 'fx:EURUSD',
  type: SymbolType.Fx,
  description: 'Euro / USD',
  exchange: 'OANDA',
  periods: [Period.OneHour],
};

const cryptoCandle = (time: number, close: number): Candle => ({
  type: SymbolType.Crypto,
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 10,
  quoteVolume: close * 10,
  trades: 1,
});

/**
 * Build an app with a compute service backed by in-memory infra; seeds the watchlist with BTC + EURUSD and BTC's candles for the period.
 */
async function buildAppWithCompute() {
  const registry = defaultIndicators();
  const watchlist = new InMemoryWatchlistRepository([BTC, EURUSD]);
  const candles = new InMemoryCandleRepository();
  await candles.save(
    BTC.id,
    Period.OneHour,
    [10, 20, 30, 40, 50].map((c, i) => cryptoCandle(i, c)),
  );
  const compute = new IndicatorComputeService(registry, watchlist, candles);
  return createApp(buildAppDeps({ indicators: { registry, compute } }));
}

describe('GET /indicators', () => {
  it('returns 200 with every registered definition', async () => {
    const registry = defaultIndicators();
    const app = buildApp(registry);
    const res = await app.inject({ method: 'GET', url: '/indicators' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(registry.list());
  });
});

describe('GET /indicators/:key', () => {
  it('returns 200 with the matching definition (sma)', async () => {
    const registry = defaultIndicators();
    const app = buildApp(registry);
    const res = await app.inject({ method: 'GET', url: '/indicators/sma' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(registry.get('sma')?.definition);
  });

  it('returns 200 with the matching definition (vwma)', async () => {
    const registry = defaultIndicators();
    const app = buildApp(registry);
    const res = await app.inject({ method: 'GET', url: '/indicators/vwma' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(registry.get('vwma')?.definition);
  });

  it('returns 404 with { error } for an unknown key', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/indicators/unknown-key' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'indicator not found: unknown-key' });
  });
});

describe('GET /symbols/:id/indicators/:key (compute)', () => {
  it('returns 200 with the warm-from-earliest SMA series, coercing string query params', async () => {
    const app = await buildAppWithCompute();
    const res = await app.inject({
      method: 'GET',
      url: '/symbols/crypto:BTCUSDT/indicators/sma?period=1h&length=3&source=close',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      indicatorKey: 'sma',
      version: 1,
      period: '1h',
      state: [
        { time: 0, value: null },
        { time: 1, value: null },
        { time: 2, value: expect.closeTo(20, 6) },
        { time: 3, value: expect.closeTo(30, 6) },
        { time: 4, value: expect.closeTo(40, 6) },
      ],
    });
  });

  it('slices to [from, to) and the slice start is already warm', async () => {
    const app = await buildAppWithCompute();
    const res = await app.inject({
      method: 'GET',
      url: '/symbols/crypto:BTCUSDT/indicators/sma?period=1h&length=3&from=3&to=5',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      indicatorKey: 'sma',
      version: 1,
      period: '1h',
      state: [
        { time: 3, value: expect.closeTo(30, 6) },
        { time: 4, value: expect.closeTo(40, 6) },
      ],
    });
  });

  it('returns 404 for an unwatched symbol', async () => {
    const app = await buildAppWithCompute();
    const res = await app.inject({
      method: 'GET',
      url: '/symbols/crypto:UNWATCHED/indicators/sma?period=1h&length=3',
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for an unknown indicator key', async () => {
    const app = await buildAppWithCompute();
    const res = await app.inject({
      method: 'GET',
      url: '/symbols/crypto:BTCUSDT/indicators/bogus?period=1h',
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 on asset-class mismatch (FX symbol + vwma)', async () => {
    const app = await buildAppWithCompute();
    const res = await app.inject({
      method: 'GET',
      url: '/symbols/fx:EURUSD/indicators/vwma?period=1h&multiplier=1&direction=both',
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 on invalid inputs (length out of range)', async () => {
    const app = await buildAppWithCompute();
    const res = await app.inject({
      method: 'GET',
      url: '/symbols/crypto:BTCUSDT/indicators/sma?period=1h&length=0',
    });
    expect(res.statusCode).toBe(400);
  });
});
