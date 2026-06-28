import { createApp } from '@lametrader/api';
import {
  type CandleBatch,
  type CryptoCandle,
  type Instrument,
  MarketDataError,
  type MarketDataSource,
  Period,
  SymbolType,
} from '@lametrader/core';
import {
  BackfillService,
  ConfigService,
  defaultIndicators,
  IndicatorService,
  InMemoryMarketDataSource,
  MongoCandleRepository,
  MongoConfigRepository,
  MongoWatchlistRepository,
  SymbolService,
} from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { FastifyInstance } from 'fastify';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** The stub instrument the catalog knows. */
const BTC: Instrument = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'BTC / USDT',
  exchange: 'Binance',
  currency: 'USDT',
};

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
 * Start a backfill on `app` and poll its job to a terminal state, returning the
 * final job. (The POST returns 202; the work runs in the background.)
 */
async function backfillAndWait(
  app: FastifyInstance,
  id = BTC.id,
  period = '1h',
): Promise<{ status: string; error: string | null }> {
  const started = await app.inject({
    method: 'POST',
    url: `/symbols/${id}/backfill`,
    payload: { period },
  });
  const { id: jobId } = started.json() as { id: string };
  for (let i = 0; i < 100; i += 1) {
    const res = await app.inject({ method: 'GET', url: `/symbols/${id}/backfill/jobs/${jobId}` });
    const job = res.json() as { status: string; error: string | null };
    if (job.status !== 'running') return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('backfill job did not settle');
}

/**
 * E2E for backfill from the API consumer's perspective: a real Fastify app over
 * real Mongo (Testcontainers) with a stub market-data source seeded with a fixed
 * candle series. Mirrors `specs/backfill.spec.md`.
 */
describe('backfill API (e2e)', () => {
  let container: StartedMongoDBContainer;
  let client: MongoClient;
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    const uri = `${container.getConnectionString()}?directConnection=true`;
    client = new MongoClient(uri);
    await client.connect();
    const db = client.db();

    const stub = new InMemoryMarketDataSource(
      [BTC],
      [SymbolType.Crypto],
      [{ id: BTC.id, period: Period.OneHour, candles: SERIES }],
    );
    const watchlist = new MongoWatchlistRepository(db);
    const candleRepo = new MongoCandleRepository(db);
    const config = new ConfigService(new MongoConfigRepository(db));
    const symbols = new SymbolService([stub], watchlist, config, candleRepo);
    const backfill = new BackfillService([stub], candleRepo, watchlist);
    const registry = defaultIndicators();
    const compute = new IndicatorService(registry, watchlist, candleRepo);

    app = createApp({ config, symbols, backfill, indicators: { registry, compute } });
    baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await app?.close();
    await client?.close();
    await container?.stop();
  });

  it('runs a backfill as an async job, streams it over WS, and reads the candles back', async () => {
    const add = await app.inject({ method: 'POST', url: '/symbols', payload: { id: BTC.id } });
    expect(add.statusCode).toBe(201);

    // POST starts the job and returns 202 with the running job.
    const run = await app.inject({
      method: 'POST',
      url: `/symbols/${BTC.id}/backfill`,
      payload: { period: '1h' },
    });
    expect(run.statusCode).toBe(202);
    const job = run.json() as { id: string; status: string };
    expect(job.status).toBe('running');

    // Stream the job over its per-job WebSocket until it reaches a terminal state.
    const wsUrl = `${baseUrl.replace('http', 'ws')}/symbols/${BTC.id}/backfill/jobs/${job.id}/progress`;
    const socket = new WebSocket(wsUrl);
    const frames: Array<{ status: string; summary: unknown }> = [];
    const gotTerminal = new Promise<void>((resolve, reject) => {
      socket.addEventListener('error', () => reject(new Error('ws failed to open')));
      socket.addEventListener('message', (event) => {
        const frame = JSON.parse(String(event.data));
        frames.push(frame);
        if (frame.status === 'succeeded' || frame.status === 'failed') resolve();
      });
    });
    await gotTerminal;
    socket.close();

    const terminal = frames.at(-1);
    expect(terminal?.status).toBe('succeeded');
    expect(terminal?.summary).toEqual({
      id: BTC.id,
      period: '1h',
      from: 1000,
      to: 3000,
      fetched: 3,
      saved: 3,
      complete: true,
    });

    const read = await app.inject({
      method: 'GET',
      url: `/symbols/${BTC.id}/candles?period=1h&from=0&to=4000`,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ candles: SERIES, nextCursor: null, latestTime: 3000 });

    // Keyset pagination: first page of 2, then the remainder from the cursor.
    const page1 = await app.inject({
      method: 'GET',
      url: `/symbols/${BTC.id}/candles?period=1h&limit=2`,
    });
    expect(page1.json()).toEqual({
      candles: [SERIES[0], SERIES[1]],
      nextCursor: 3000,
      latestTime: 3000,
    });

    const page2 = await app.inject({
      method: 'GET',
      url: `/symbols/${BTC.id}/candles?period=1h&from=3000&limit=2`,
    });
    expect(page2.json()).toEqual({ candles: [SERIES[2]], nextCursor: null, latestTime: 3000 });
  });

  it('rejects streaming a job progress under a symbol path that does not own it', async () => {
    await app.inject({ method: 'POST', url: '/symbols', payload: { id: BTC.id } });
    const run = await app.inject({
      method: 'POST',
      url: `/symbols/${BTC.id}/backfill`,
      payload: { period: '1h' },
    });
    const job = run.json() as { id: string };

    // Connect under a different symbol's path carrying BTC's real job id.
    const wsUrl = `${baseUrl.replace('http', 'ws')}/symbols/crypto:ETHUSDT/backfill/jobs/${job.id}/progress`;
    const socket = new WebSocket(wsUrl);
    const frame = await new Promise<unknown>((resolve, reject) => {
      socket.addEventListener('error', () => reject(new Error('ws failed to open')));
      socket.addEventListener('message', (event) => resolve(JSON.parse(String(event.data))));
    });
    socket.close();

    expect(frame).toEqual({ error: `backfill job not found: ${job.id}` });
  });

  it('returns 404 and persists nothing when backfilling an unwatched symbol', async () => {
    const run = await app.inject({
      method: 'POST',
      url: '/symbols/crypto:ETHUSDT/backfill',
      payload: { period: '1h' },
    });
    expect(run.statusCode).toBe(404);

    const read = await app.inject({
      method: 'GET',
      url: '/symbols/crypto:ETHUSDT/candles?period=1h&from=0&to=4000',
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ candles: [], nextCursor: null, latestTime: null });
  });

  it('records an upstream failure as a failed job carrying the reason', async () => {
    const db = client.db();
    await new MongoWatchlistRepository(db).add({ ...BTC, periods: [Period.OneHour] });

    const failing: MarketDataSource = {
      types: [SymbolType.Crypto],
      periods: [Period.OneHour],
      search: async () => [],
      lookup: async () => BTC,
      fetchCandles: async (): Promise<CandleBatch> => {
        throw new MarketDataError('Binance failed to fetch candles for crypto:BTCUSDT: 418');
      },
    };
    const failConfig = new ConfigService(new MongoConfigRepository(db));
    const failCandles = new MongoCandleRepository(db);
    const failWatchlist = new MongoWatchlistRepository(db);
    const failRegistry = defaultIndicators();
    const failApp = createApp({
      config: failConfig,
      symbols: new SymbolService([failing], failWatchlist, failConfig, failCandles),
      backfill: new BackfillService([failing], failCandles, failWatchlist),
      indicators: {
        registry: failRegistry,
        compute: new IndicatorService(failRegistry, failWatchlist, failCandles),
      },
    });

    const job = await backfillAndWait(failApp);
    expect(job.status).toBe('failed');
    expect(job.error).toBe('Binance failed to fetch candles for crypto:BTCUSDT: 418');
    await failApp.close();
  });

  it('deleting a symbol cascades to its stored candles', async () => {
    // Ensure watched + backfilled (idempotent — 201 first time, else 409).
    await app.inject({ method: 'POST', url: '/symbols', payload: { id: BTC.id } });
    const job = await backfillAndWait(app);
    expect(job.status).toBe('succeeded');
    const before = await app.inject({
      method: 'GET',
      url: `/symbols/${BTC.id}/candles?period=1h`,
    });
    expect((before.json() as { candles: unknown[] }).candles.length).toBeGreaterThan(0);

    const del = await app.inject({ method: 'DELETE', url: `/symbols/${BTC.id}` });
    expect(del.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: `/symbols/${BTC.id}/candles?period=1h`,
    });
    expect(after.json()).toEqual({ candles: [], nextCursor: null, latestTime: null });
  });
});
