import {
  type CryptoCandle,
  type Instrument,
  type MarketDataSource,
  Period,
  SymbolType,
} from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { Model } from 'mongoose';
import request from 'supertest';
import { WebSocket } from 'ws';
import { AppModule } from '../src/app.module.js';
import { MarketDataError } from '../src/common/domain/symbol.js';
import { InMemoryMarketDataSource } from '../src/market/market-data/in-memory-market-data-source.js';
import { MARKET_DATA_SOURCES } from '../src/market/market-data/market-data-source.token.js';
import { CandleEntry } from '../src/market/persistence/candle-entry.schema.js';
import { WatchlistEntry } from '../src/market/persistence/watchlist-entry.schema.js';

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
 * E2E for the candles + backfill resource from the API consumer's perspective:
 * the real Nest app over a real Mongo (Testcontainers), with an in-memory stub
 * market-data source (seeded with a fixed series) substituted for the default
 * sources so a symbol can be watched and backfilled without a third-party API.
 * Exercises the 202 async-job flow, the per-job progress WebSocket, the
 * keyset-paginated candle reads, one failure mode, and the symbol-removal candle
 * cascade over HTTP. Mirrors the old Fastify `backfill.e2e.test.ts`.
 */
describe('backfill API (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let watchlistModel: Model<WatchlistEntry>;
  let candleModel: Model<CandleEntry>;

  /** Open the per-job WS and resolve the terminal frame. */
  function streamToTerminal(
    id: string,
    jobId: string,
  ): Promise<{ status: string; summary: unknown }> {
    const socket = new WebSocket(
      `${baseUrl.replace('http', 'ws')}/symbols/${id}/backfill/jobs/${jobId}/progress`,
    );
    return new Promise((resolve, reject) => {
      socket.on('error', () => reject(new Error('ws failed to open')));
      socket.on('message', (data) => {
        const frame = JSON.parse(String(data)) as { status: string; summary: unknown };
        if (frame.status === 'succeeded' || frame.status === 'failed') {
          socket.close();
          resolve(frame);
        }
      });
    });
  }

  /** Start a backfill and poll its job to a terminal state. */
  async function backfillAndWait(id = BTC.id): Promise<{ status: string; error: string | null }> {
    const started = await request(app.getHttpServer())
      .post(`/symbols/${id}/backfill`)
      .send({ period: '1h' });
    const jobId = started.body.id as string;
    for (let i = 0; i < 100; i += 1) {
      const res = await request(app.getHttpServer()).get(`/symbols/${id}/backfill/jobs/${jobId}`);
      const job = res.body as { status: string; error: string | null };
      if (job.status !== 'running') return job;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('backfill job did not settle');
  }

  beforeAll(async () => {
    const stub = new InMemoryMarketDataSource(
      [BTC],
      [SymbolType.Crypto],
      [{ id: BTC.id, period: Period.OneHour, candles: SERIES }],
    );
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MARKET_DATA_SOURCES)
      .useValue([stub])
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    watchlistModel = app.get<Model<WatchlistEntry>>(getModelToken(WatchlistEntry.name));
    candleModel = app.get<Model<CandleEntry>>(getModelToken(CandleEntry.name));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await watchlistModel.deleteMany({});
    await candleModel.deleteMany({});
  });

  it('runs a backfill as an async job, streams it over WS, and reads the candles back', async () => {
    const server = app.getHttpServer();
    const add = await request(server).post('/symbols').send({ id: BTC.id });
    expect(add.status).toBe(201);

    const run = await request(server).post(`/symbols/${BTC.id}/backfill`).send({ period: '1h' });
    expect({ status: run.status, jobStatus: run.body.status }).toEqual({
      status: 202,
      jobStatus: 'running',
    });

    const terminal = await streamToTerminal(BTC.id, run.body.id);
    expect(terminal).toEqual({
      id: run.body.id,
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

    const read = await request(server).get(`/symbols/${BTC.id}/candles?period=1h&from=0&to=4000`);
    expect({ status: read.status, body: read.body }).toEqual({
      status: 200,
      body: { candles: SERIES, nextCursor: null, latestTime: 3000 },
    });

    const page1 = await request(server).get(`/symbols/${BTC.id}/candles?period=1h&limit=2`);
    expect(page1.body).toEqual({
      candles: [SERIES[0], SERIES[1]],
      nextCursor: 3000,
      latestTime: 3000,
    });
    const page2 = await request(server).get(
      `/symbols/${BTC.id}/candles?period=1h&from=3000&limit=2`,
    );
    expect(page2.body).toEqual({ candles: [SERIES[2]], nextCursor: null, latestTime: 3000 });
  });

  it('rejects streaming a job progress under a symbol path that does not own it', async () => {
    const server = app.getHttpServer();
    await request(server).post('/symbols').send({ id: BTC.id });
    const run = await request(server).post(`/symbols/${BTC.id}/backfill`).send({ period: '1h' });

    const socket = new WebSocket(
      `${baseUrl.replace('http', 'ws')}/symbols/crypto:ETHUSDT/backfill/jobs/${run.body.id}/progress`,
    );
    const frame = await new Promise<unknown>((resolve, reject) => {
      socket.on('error', () => reject(new Error('ws failed to open')));
      socket.on('message', (data) => resolve(JSON.parse(String(data))));
    });
    socket.close();

    expect(frame).toEqual({ error: `backfill job not found: ${run.body.id}` });
  });

  it('returns 404 and persists nothing when backfilling an unwatched symbol', async () => {
    const server = app.getHttpServer();
    const run = await request(server)
      .post('/symbols/crypto:ETHUSDT/backfill')
      .send({ period: '1h' });
    expect(run.status).toBe(404);

    const read = await request(server).get(
      '/symbols/crypto:ETHUSDT/candles?period=1h&from=0&to=4000',
    );
    expect({ status: read.status, body: read.body }).toEqual({
      status: 200,
      body: { candles: [], nextCursor: null, latestTime: null },
    });
  });

  it('records an upstream failure as a failed job carrying the reason', async () => {
    const failing: MarketDataSource = {
      types: [SymbolType.Crypto],
      periods: [Period.OneHour],
      search: async () => [],
      lookup: async () => BTC,
      fetchCandles: async () => {
        throw new MarketDataError('Binance failed to fetch candles for crypto:BTCUSDT: 418');
      },
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MARKET_DATA_SOURCES)
      .useValue([failing])
      .compile();
    const failApp = moduleRef.createNestApplication();
    await failApp.init();
    try {
      await request(failApp.getHttpServer()).post('/symbols').send({ id: BTC.id });
      const started = await request(failApp.getHttpServer())
        .post(`/symbols/${BTC.id}/backfill`)
        .send({ period: '1h' });
      expect(started.status).toBe(202);
      let job = { status: 'running', error: null as string | null };
      for (let i = 0; i < 100 && job.status === 'running'; i += 1) {
        const res = await request(failApp.getHttpServer()).get(
          `/symbols/${BTC.id}/backfill/jobs/${started.body.id}`,
        );
        job = res.body as { status: string; error: string | null };
        if (job.status === 'running') await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect({ status: job.status, error: job.error }).toEqual({
        status: 'failed',
        error: 'Binance failed to fetch candles for crypto:BTCUSDT: 418',
      });
    } finally {
      await failApp.close();
    }
  });

  it('deleting a symbol cascades to its stored candles', async () => {
    const server = app.getHttpServer();
    await request(server).post('/symbols').send({ id: BTC.id });
    const job = await backfillAndWait();
    expect(job.status).toBe('succeeded');
    const before = await request(server).get(`/symbols/${BTC.id}/candles?period=1h`);
    expect(before.body.candles.length).toBeGreaterThan(0);

    const del = await request(server).delete(`/symbols/${BTC.id}`);
    expect(del.status).toBe(204);

    const after = await request(server).get(`/symbols/${BTC.id}/candles?period=1h`);
    expect(after.body).toEqual({ candles: [], nextCursor: null, latestTime: null });
  });
});
