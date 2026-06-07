import { createApp } from '@lametrader/api';
import {
  type Candle,
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
    const config = new ConfigService(new MongoConfigRepository(db));
    const symbols = new SymbolService([stub], watchlist, config);
    const backfill = new BackfillService([stub], new MongoCandleRepository(db), watchlist);

    app = createApp({ config, symbols, backfill });
    baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await app?.close();
    await client?.close();
    await container?.stop();
  });

  it('backfills a watched symbol, streams progress over WS, and reads the candles back', async () => {
    const add = await app.inject({ method: 'POST', url: '/symbols', payload: { id: BTC.id } });
    expect(add.statusCode).toBe(201);

    // Subscribe to progress before triggering the backfill.
    const wsUrl = `${baseUrl.replace('http', 'ws')}/symbols/${BTC.id}/backfill/progress`;
    const socket = new WebSocket(wsUrl);
    const frames: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', () => reject(new Error('ws failed to open')));
    });
    const gotSummary = new Promise<void>((resolve) => {
      socket.addEventListener('message', (event) => {
        const frame = JSON.parse(String(event.data));
        frames.push(frame);
        if (frame.type === 'summary') resolve();
      });
    });

    const run = await app.inject({
      method: 'POST',
      url: `/symbols/${BTC.id}/backfill`,
      payload: { period: '1h' },
    });
    expect(run.statusCode).toBe(200);
    expect(run.json()).toEqual({
      id: BTC.id,
      period: '1h',
      from: 1000,
      to: 3000,
      fetched: 3,
      saved: 3,
    });

    await gotSummary;
    socket.close();
    expect(frames).toEqual([
      { type: 'progress', saved: 3, total: 3 },
      {
        type: 'summary',
        summary: { id: BTC.id, period: '1h', from: 1000, to: 3000, fetched: 3, saved: 3 },
      },
    ]);

    const read = await app.inject({
      method: 'GET',
      url: `/symbols/${BTC.id}/candles?period=1h&from=0&to=4000`,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ candles: SERIES, nextCursor: null });

    // Keyset pagination: first page of 2, then the remainder from the cursor.
    const page1 = await app.inject({
      method: 'GET',
      url: `/symbols/${BTC.id}/candles?period=1h&limit=2`,
    });
    expect(page1.json()).toEqual({ candles: [SERIES[0], SERIES[1]], nextCursor: 3000 });

    const page2 = await app.inject({
      method: 'GET',
      url: `/symbols/${BTC.id}/candles?period=1h&from=3000&limit=2`,
    });
    expect(page2.json()).toEqual({ candles: [SERIES[2]], nextCursor: null });
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
    expect(read.json()).toEqual({ candles: [], nextCursor: null });
  });

  it('returns 502 with the upstream reason when the market-data source fails', async () => {
    const db = client.db();
    await new MongoWatchlistRepository(db).add({ ...BTC, periods: [Period.OneHour] });

    const failing: MarketDataSource = {
      types: [SymbolType.Crypto],
      search: async () => [],
      lookup: async () => BTC,
      fetchCandles: async (): Promise<Candle[]> => {
        throw new MarketDataError('Binance failed to fetch candles for crypto:BTCUSDT: 418');
      },
    };
    const failApp = createApp({
      config: new ConfigService(new MongoConfigRepository(db)),
      backfill: new BackfillService(
        [failing],
        new MongoCandleRepository(db),
        new MongoWatchlistRepository(db),
      ),
    });

    const res = await failApp.inject({
      method: 'POST',
      url: `/symbols/${BTC.id}/backfill`,
      payload: { period: '1h' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({
      error: 'Binance failed to fetch candles for crypto:BTCUSDT: 418',
    });
    await failApp.close();
  });
});
