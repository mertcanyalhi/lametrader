import {
  type CandleBatch,
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
 * Start a backfill and poll its job to a terminal state, returning the final job.
 * (The POST returns 202 immediately; the work runs in the background.)
 */
async function backfillAndWait(
  app: ReturnType<typeof buildApp>,
  id = BTC.id,
  period = '1h',
): Promise<Record<string, unknown>> {
  const started = await app.inject({
    method: 'POST',
    url: `/symbols/${id}/backfill`,
    payload: { period },
  });
  const { id: jobId } = started.json() as { id: string };
  for (let i = 0; i < 50; i += 1) {
    const res = await app.inject({ method: 'GET', url: `/symbols/${id}/backfill/jobs/${jobId}` });
    const job = res.json() as Record<string, unknown>;
    if (job.status !== 'running') return job;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('backfill job did not settle');
}

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
  it('starts a backfill job for a watched symbol → 202 with the running job', async () => {
    const res = await buildApp().inject({
      method: 'POST',
      url: `/symbols/${BTC.id}/backfill`,
      payload: { period: '1h' },
    });
    expect(res.statusCode).toBe(202);
    const job = res.json();
    expect(job).toEqual({
      id: expect.any(String),
      symbolId: BTC.id,
      period: '1h',
      status: 'running',
      progress: null,
      summary: null,
      error: null,
    });
  });

  it('runs the job to succeeded with the summary', async () => {
    const job = await backfillAndWait(buildApp());
    expect(job).toEqual({
      id: expect.any(String),
      symbolId: BTC.id,
      period: '1h',
      status: 'succeeded',
      progress: { saved: 3, total: 3 },
      summary: {
        id: BTC.id,
        period: '1h',
        from: 1000,
        to: 3000,
        fetched: 3,
        saved: 3,
        complete: true,
      },
      error: null,
    });
  });

  it('returns 409 when a backfill for the same symbol+period is already running', async () => {
    // A source whose fetch never resolves, so the first job stays Running.
    const hanging: MarketDataSource = {
      types: [SymbolType.Crypto],
      periods: [Period.OneHour],
      search: async () => [],
      lookup: async () => null,
      fetchCandles: () => new Promise(() => {}),
    };
    const backfill = new BackfillService(
      [hanging],
      new InMemoryCandleRepository(),
      new InMemoryWatchlistRepository([WATCHED]),
    );
    const app = createApp(buildAppDeps({ backfill }));

    const first = await app.inject({
      method: 'POST',
      url: `/symbols/${BTC.id}/backfill`,
      payload: { period: '1h' },
    });
    expect(first.statusCode).toBe(202);
    const second = await app.inject({
      method: 'POST',
      url: `/symbols/${BTC.id}/backfill`,
      payload: { period: '1h' },
    });
    expect(second.statusCode).toBe(409);
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

  it('records an upstream failure as a failed job (POST still 202)', async () => {
    const failing: MarketDataSource = {
      types: [SymbolType.Crypto],
      periods: [Period.OneHour],
      search: async () => [],
      lookup: async () => null,
      fetchCandles: async (): Promise<CandleBatch> => {
        throw new MarketDataError('Binance failed to fetch candles for crypto:BTCUSDT: 418');
      },
    };
    const backfill = new BackfillService(
      [failing],
      new InMemoryCandleRepository(),
      new InMemoryWatchlistRepository([WATCHED]),
    );
    const app = createApp(buildAppDeps({ backfill }));

    const job = await backfillAndWait(app);
    expect(job.status).toBe('failed');
    expect(job.error).toBe('Binance failed to fetch candles for crypto:BTCUSDT: 418');
  });
});

describe('GET /symbols/:id/backfill/jobs/:jobId', () => {
  it('returns 404 for an unknown job id', async () => {
    const res = await buildApp().inject({
      method: 'GET',
      url: `/symbols/${BTC.id}/backfill/jobs/nope`,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /symbols/:id/candles', () => {
  it('returns a page of stored candles after a backfill → 200', async () => {
    const app = buildApp();
    await backfillAndWait(app);
    const res = await app.inject({
      method: 'GET',
      url: `/symbols/${BTC.id}/candles?period=1h&from=0&to=4000`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ candles: SERIES, nextCursor: null });
  });

  it('paginates by keyset cursor with limit → 200', async () => {
    const app = buildApp();
    await backfillAndWait(app);
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
