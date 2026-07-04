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

/** One streamed backfill-job frame (the modal reads these bare job objects). */
interface JobFrame {
  status: string;
  progress: { saved: number; total: number } | null;
  summary: unknown;
  error: string | null;
}

/**
 * E2E for the backfill UI's HTTP + WebSocket contract — the same Nest app the
 * browser hits, over real Mongo (Testcontainers) with a stub source. Traces the
 * round-trip the modal drives (`POST` start → per-job WS stream → terminal frame)
 * and its critical failure mode (the retry path). Mirrors the old Fastify
 * `backfill-ui.e2e.test.ts`.
 */
describe('backfill UI contract (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let watchlistModel: Model<WatchlistEntry>;

  /** Connect to a job's per-job WebSocket and resolve the terminal frame. */
  function streamToTerminal(url: string, id: string, jobId: string): Promise<JobFrame> {
    const socket = new WebSocket(
      `${url.replace('http', 'ws')}/symbols/${id}/backfill/jobs/${jobId}/progress`,
    );
    return new Promise<JobFrame>((resolve, reject) => {
      socket.on('error', () => reject(new Error('ws failed to open')));
      socket.on('message', (data) => {
        const frame = JSON.parse(String(data)) as JobFrame;
        if (frame.status === 'succeeded' || frame.status === 'failed') {
          socket.close();
          resolve(frame);
        }
      });
    });
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
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await watchlistModel.deleteMany({});
  });

  it('starts a backfill and streams it over the per-job WebSocket to a success summary', async () => {
    await request(app.getHttpServer()).post('/symbols').send({ id: BTC.id });
    const started = await request(app.getHttpServer())
      .post(`/symbols/${BTC.id}/backfill`)
      .send({ period: '1h' });
    const terminal = await streamToTerminal(baseUrl, BTC.id, started.body.id);

    expect({
      startStatus: started.status,
      startJobStatus: started.body.status,
      terminalStatus: terminal.status,
      summary: terminal.summary,
    }).toEqual({
      startStatus: 202,
      startJobStatus: 'running',
      terminalStatus: 'succeeded',
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
  });

  it('streams a failed frame carrying the upstream error (the modal retry path)', async () => {
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
    await failApp.listen(0, '127.0.0.1');
    const failUrl = await failApp.getUrl();
    try {
      await request(failApp.getHttpServer()).post('/symbols').send({ id: BTC.id });
      const started = await request(failApp.getHttpServer())
        .post(`/symbols/${BTC.id}/backfill`)
        .send({ period: '1h' });
      const terminal = await streamToTerminal(failUrl, BTC.id, started.body.id);

      expect({ status: terminal.status, error: terminal.error }).toEqual({
        status: 'failed',
        error: 'Binance failed to fetch candles for crypto:BTCUSDT: 418',
      });
    } finally {
      await failApp.close();
    }
  });
});
