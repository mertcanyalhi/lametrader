import {
  type Candle,
  type ConfigRepository,
  type CryptoCandle,
  type Instrument,
  MarketDataError,
  type MarketDataSource,
  Period,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import {
  BackfillService,
  ConfigService,
  InMemoryCandleRepository,
  InMemoryMarketDataSource,
  InMemoryWatchlistRepository,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { buildAppDeps } from '../testing/app-deps';

/** The stub instrument the catalog knows. */
const BTC: Instrument = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'Bitcoin / TetherUS',
  exchange: 'Binance',
  currency: 'USDT',
};

/** BTC as a watched symbol (period 1h only). */
const WATCHED: WatchedSymbol = { ...BTC, periods: [Period.OneHour] };

/** Build a crypto candle at `time`. */
const candle = (time: number): CryptoCandle => ({
  type: SymbolType.Crypto,
  time,
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
  volume: 10,
  quoteVolume: 15,
  trades: 3,
});

/** The seeded series the stub source serves for BTC @ 1h. */
const SERIES: CryptoCandle[] = [candle(1000), candle(2000), candle(3000)];

/**
 * Build an app whose BackfillService runs over an in-memory source (seeded with
 * {@link SERIES}), candle store, and a watchlist holding {@link WATCHED} — so the
 * candle routes are exercised through the use-case and the shared error handler
 * without I/O. (The WebSocket progress route needs a real server and is covered in
 * the e2e tier.)
 */
function buildApp() {
  const source = new InMemoryMarketDataSource(
    [BTC],
    [SymbolType.Crypto],
    [{ id: BTC.id, period: Period.OneHour, candles: SERIES }],
  );
  const backfill = new BackfillService(
    [source],
    new InMemoryCandleRepository(),
    new InMemoryWatchlistRepository([WATCHED]),
  );
  const configRepo: ConfigRepository = { load: async () => null, save: async () => {} };
  return createApp(buildAppDeps({ config: new ConfigService(configRepo), backfill }));
}

describe('POST /symbols/:id/backfill', () => {
  it('backfills a watched symbol → 200 with the summary', async () => {
    const res = await buildApp().inject({
      method: 'POST',
      url: `/symbols/${BTC.id}/backfill`,
      payload: { period: '1h' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: BTC.id,
      period: '1h',
      from: 1000,
      to: 3000,
      fetched: 3,
      saved: 3,
      complete: true,
    });
  });

  it('returns 404 when the symbol is not watched', async () => {
    const res = await buildApp().inject({
      method: 'POST',
      url: '/symbols/crypto:ETHUSDT/backfill',
      payload: { period: '1h' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for a period the symbol does not watch', async () => {
    const res = await buildApp().inject({
      method: 'POST',
      url: `/symbols/${BTC.id}/backfill`,
      payload: { period: '1d' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for an invalid range (from >= to)', async () => {
    const res = await buildApp().inject({
      method: 'POST',
      url: `/symbols/${BTC.id}/backfill`,
      payload: { period: '1h', from: 2000, to: 1000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 502 with the upstream reason when the source fails', async () => {
    const failing: MarketDataSource = {
      types: [SymbolType.Crypto],
      search: async () => [],
      lookup: async () => null,
      fetchCandles: async (): Promise<Candle[]> => {
        throw new MarketDataError('Binance failed to fetch candles for crypto:BTCUSDT: 418');
      },
    };
    const backfill = new BackfillService(
      [failing],
      new InMemoryCandleRepository(),
      new InMemoryWatchlistRepository([WATCHED]),
    );
    const configRepo: ConfigRepository = { load: async () => null, save: async () => {} };
    const app = createApp({ config: new ConfigService(configRepo), backfill });

    const res = await app.inject({
      method: 'POST',
      url: `/symbols/${BTC.id}/backfill`,
      payload: { period: '1h' },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({
      error: 'Binance failed to fetch candles for crypto:BTCUSDT: 418',
    });
  });
});

describe('GET /symbols/:id/candles', () => {
  it('returns a page of stored candles after a backfill → 200', async () => {
    const app = buildApp();
    await app.inject({
      method: 'POST',
      url: `/symbols/${BTC.id}/backfill`,
      payload: { period: '1h' },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/symbols/${BTC.id}/candles?period=1h&from=0&to=4000`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ candles: SERIES, nextCursor: null });
  });

  it('paginates by keyset cursor with limit → 200', async () => {
    const app = buildApp();
    await app.inject({
      method: 'POST',
      url: `/symbols/${BTC.id}/backfill`,
      payload: { period: '1h' },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/symbols/${BTC.id}/candles?period=1h&limit=2`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ candles: [SERIES[0], SERIES[1]], nextCursor: 3000 });
  });

  it('returns an empty page when nothing is stored → 200', async () => {
    const res = await buildApp().inject({
      method: 'GET',
      url: `/symbols/${BTC.id}/candles?period=1h`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ candles: [], nextCursor: null });
  });

  it('rejects a limit over the maximum → 400', async () => {
    const res = await buildApp().inject({
      method: 'GET',
      url: `/symbols/${BTC.id}/candles?period=1h&limit=1001`,
    });
    expect(res.statusCode).toBe(400);
  });
});
