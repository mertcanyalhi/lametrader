import {
  type CandleRepository,
  type CryptoCandle,
  type Instrument,
  type MarketDataSource,
  Period,
  SymbolType,
} from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { WebSocket } from 'ws';
import { DomainExceptionFilter } from '../common/domain-exception.filter.js';
import { buildValidationPipe } from '../common/validation.pipe.js';
import { MarketDataError } from '../domain/symbol.js';
import { InMemoryMarketDataSource } from '../market-data/in-memory-market-data-source.js';
import { MARKET_DATA_SOURCES } from '../market-data/market-data-source.token.js';
import { InMemoryWatchlistRepository } from '../watchlist/in-memory-watchlist.repository.js';
import { WATCHLIST_REPOSITORY } from '../watchlist/watchlist-repository.token.js';
import { BackfillService } from './backfill.service.js';
import { BackfillJobService } from './backfill-job.service.js';
import type { BackfillJob } from './backfill-job.types.js';
import { BACKFILL_JOB_STREAM } from './backfill-job-stream.token.js';
import { BackfillProgressGateway } from './backfill-progress.gateway.js';
import { CANDLE_REPOSITORY } from './candle-repository.token.js';
import { CandlesController } from './candles.controller.js';
import { InMemoryCandleRepository } from './in-memory-candle.repository.js';
import { StreamHub } from './stream-hub.js';

/**
 * Local (Docker-free) integration proof of the candles + backfill HTTP **and**
 * WebSocket contract: the {@link CandlesController} and
 * {@link BackfillProgressGateway} behind the real global validation pipe and
 * exception filter, over in-memory candle / watchlist stores and a stub
 * market-data source. Pins routes, verbs, status codes, payload shapes, the 202
 * async-job flow, and the per-job progress WS protocol for every in-scope surface
 * so the container-backed e2e tier only has to prove the Mongo wiring.
 */
describe('candles + backfill HTTP/WS contract (integration)', () => {
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

  let app: INestApplication;
  let baseUrl: string;

  /**
   * Build the app over in-memory stores with the given source + watchlist seed,
   * start it listening (needed for the WebSocket upgrade), and return it.
   */
  async function buildApp(
    opts: { source?: MarketDataSource; watched?: boolean } = {},
  ): Promise<INestApplication> {
    const source =
      opts.source ??
      new InMemoryMarketDataSource(
        [BTC],
        [SymbolType.Crypto],
        [{ id: BTC.id, period: Period.OneHour, candles: SERIES }],
      );
    const watchlist = new InMemoryWatchlistRepository(
      opts.watched === false ? [] : [{ ...BTC, periods: [Period.OneHour] }],
    );
    const candles = new InMemoryCandleRepository();
    const moduleRef = await Test.createTestingModule({
      controllers: [CandlesController],
      providers: [
        { provide: MARKET_DATA_SOURCES, useValue: [source] },
        { provide: CANDLE_REPOSITORY, useValue: candles },
        { provide: WATCHLIST_REPOSITORY, useValue: watchlist },
        {
          provide: BackfillService,
          useFactory: () => new BackfillService([source], candles, watchlist),
        },
        { provide: BACKFILL_JOB_STREAM, useFactory: () => new StreamHub<BackfillJob>() },
        {
          provide: BackfillJobService,
          useFactory: (backfill: BackfillService, hub: StreamHub<BackfillJob>) =>
            new BackfillJobService(backfill, (job) => hub.publish(job.id, job)),
          inject: [BackfillService, BACKFILL_JOB_STREAM],
        },
        BackfillProgressGateway,
      ],
    }).compile();
    const nestApp = moduleRef.createNestApplication();
    nestApp.useGlobalPipes(buildValidationPipe());
    nestApp.useGlobalFilters(new DomainExceptionFilter());
    await nestApp.listen(0, '127.0.0.1');
    return nestApp;
  }

  /** Poll a job over HTTP until it leaves `running`, returning the settled job. */
  async function pollJob(id: string, jobId: string): Promise<BackfillJob> {
    for (let i = 0; i < 100; i += 1) {
      const res = await request(app.getHttpServer()).get(`/symbols/${id}/backfill/jobs/${jobId}`);
      const job = res.body as BackfillJob;
      if (job.status !== 'running') return job;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('backfill job did not settle');
  }

  /** Open the per-job progress WS and resolve the terminal frame (or reject). */
  function streamToTerminal(id: string, jobId: string): Promise<BackfillJob> {
    const socket = new WebSocket(
      `${baseUrl.replace('http', 'ws')}/symbols/${id}/backfill/jobs/${jobId}/progress`,
    );
    return new Promise<BackfillJob>((resolve, reject) => {
      socket.on('error', () => reject(new Error('ws failed to open')));
      socket.on('message', (data) => {
        const frame = JSON.parse(String(data)) as BackfillJob;
        if (frame.status === 'succeeded' || frame.status === 'failed') {
          socket.close();
          resolve(frame);
        }
      });
    });
  }

  /** Open the per-job progress WS and resolve the first frame received. */
  function firstFrame(id: string, jobId: string): Promise<unknown> {
    const socket = new WebSocket(
      `${baseUrl.replace('http', 'ws')}/symbols/${id}/backfill/jobs/${jobId}/progress`,
    );
    return new Promise<unknown>((resolve, reject) => {
      socket.on('error', () => reject(new Error('ws failed to open')));
      socket.on('message', (data) => {
        socket.close();
        resolve(JSON.parse(String(data)));
      });
    });
  }

  afterEach(async () => {
    await app?.close();
  });

  it('GET /symbols/:id/candles returns an empty page with a null latest when nothing is stored', async () => {
    app = await buildApp();
    baseUrl = await app.getUrl();
    const res = await request(app.getHttpServer()).get(`/symbols/${BTC.id}/candles?period=1h`);
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: { candles: [], nextCursor: null, latestTime: null },
    });
  });

  it('GET /symbols/:id/candles returns an empty page carrying latestTime when history sits outside the window', async () => {
    app = await buildApp();
    baseUrl = await app.getUrl();
    // History exists (latest at 3000) but entirely before the requested window —
    // the re-anchor signal (#70): candles empty, latestTime still points at it.
    const candles = app.get<CandleRepository>(CANDLE_REPOSITORY);
    await candles.save(BTC.id, Period.OneHour, SERIES);

    const res = await request(app.getHttpServer()).get(
      `/symbols/${BTC.id}/candles?period=1h&from=100000&to=200000`,
    );

    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: { candles: [], nextCursor: null, latestTime: 3000 },
    });
  });

  it('POST /symbols/:id/backfill runs an async job, streams it over WS, and reads the candles back', async () => {
    app = await buildApp();
    baseUrl = await app.getUrl();

    // POST starts the job and returns 202 with the running job.
    const started = await request(app.getHttpServer())
      .post(`/symbols/${BTC.id}/backfill`)
      .send({ period: '1h' });
    expect({ status: started.status, jobStatus: started.body.status }).toEqual({
      status: 202,
      jobStatus: 'running',
    });

    // Stream the per-job WebSocket to its terminal frame.
    const terminal = await streamToTerminal(BTC.id, started.body.id);
    expect({ status: terminal.status, summary: terminal.summary }).toEqual({
      status: 'succeeded',
      summary: {
        id: BTC.id,
        period: '1h',
        from: 1000,
        to: 3000,
        fetched: 3,
        saved: 3,
        complete: true,
      },
    });

    // Read the whole window back.
    const read = await request(app.getHttpServer()).get(
      `/symbols/${BTC.id}/candles?period=1h&from=0&to=4000`,
    );
    expect({ status: read.status, body: read.body }).toEqual({
      status: 200,
      body: { candles: SERIES, nextCursor: null, latestTime: 3000 },
    });

    // Keyset pagination: first page of 2, then the remainder from the cursor.
    const page1 = await request(app.getHttpServer()).get(
      `/symbols/${BTC.id}/candles?period=1h&limit=2`,
    );
    expect(page1.body).toEqual({
      candles: [SERIES[0], SERIES[1]],
      nextCursor: 3000,
      latestTime: 3000,
    });
    const page2 = await request(app.getHttpServer()).get(
      `/symbols/${BTC.id}/candles?period=1h&from=3000&limit=2`,
    );
    expect(page2.body).toEqual({ candles: [SERIES[2]], nextCursor: null, latestTime: 3000 });
  });

  it('rejects streaming a job under a symbol path that does not own it with an error frame', async () => {
    app = await buildApp();
    baseUrl = await app.getUrl();
    const started = await request(app.getHttpServer())
      .post(`/symbols/${BTC.id}/backfill`)
      .send({ period: '1h' });

    const frame = await firstFrame('crypto:ETHUSDT', started.body.id);
    expect(frame).toEqual({ error: `backfill job not found: ${started.body.id}` });
  });

  it('GET a backfill job under the wrong symbol path returns 404', async () => {
    app = await buildApp();
    baseUrl = await app.getUrl();
    const started = await request(app.getHttpServer())
      .post(`/symbols/${BTC.id}/backfill`)
      .send({ period: '1h' });

    const res = await request(app.getHttpServer()).get(
      `/symbols/crypto:ETHUSDT/backfill/jobs/${started.body.id}`,
    );
    expect({ status: res.status, body: res.body }).toEqual({
      status: 404,
      body: { error: `backfill job not found: ${started.body.id}` },
    });
  });

  it('POST /symbols/:id/backfill returns 404 for an unwatched symbol', async () => {
    app = await buildApp({ watched: false });
    baseUrl = await app.getUrl();
    const res = await request(app.getHttpServer())
      .post(`/symbols/${BTC.id}/backfill`)
      .send({ period: '1h' });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 404,
      body: { error: `symbol not watched: ${BTC.id}` },
    });
  });

  it('POST /symbols/:id/backfill returns a domain 400 for a period the symbol does not watch', async () => {
    app = await buildApp();
    baseUrl = await app.getUrl();
    const res = await request(app.getHttpServer())
      .post(`/symbols/${BTC.id}/backfill`)
      .send({ period: '1d' });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 400,
      body: { error: `period 1d is not watched for ${BTC.id}` },
    });
  });

  it('POST /symbols/:id/backfill returns a domain 400 for an inverted range', async () => {
    app = await buildApp();
    baseUrl = await app.getUrl();
    const res = await request(app.getHttpServer())
      .post(`/symbols/${BTC.id}/backfill`)
      .send({ period: '1h', from: 5000, to: 1000 });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 400,
      body: { error: 'backfill range "from" (5000) must be before "to" (1000)' },
    });
  });

  it('POST /symbols/:id/backfill rejects a missing period with the validation envelope', async () => {
    app = await buildApp();
    baseUrl = await app.getUrl();
    const res = await request(app.getHttpServer()).post(`/symbols/${BTC.id}/backfill`).send({});
    expect({
      status: res.status,
      error: res.body.error,
      paths: res.body.fields.map((f: { path: string }) => f.path),
    }).toEqual({ status: 400, error: 'Validation failed', paths: ['period'] });
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
    app = await buildApp({ source: failing });
    baseUrl = await app.getUrl();

    const started = await request(app.getHttpServer())
      .post(`/symbols/${BTC.id}/backfill`)
      .send({ period: '1h' });
    expect(started.status).toBe(202);
    const job = await pollJob(BTC.id, started.body.id);
    expect({ status: job.status, error: job.error }).toEqual({
      status: 'failed',
      error: 'Binance failed to fetch candles for crypto:BTCUSDT: 418',
    });
  });
});
