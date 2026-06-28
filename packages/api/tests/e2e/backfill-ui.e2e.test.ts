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

/** One streamed backfill-job frame (the modal reads these bare job objects). */
interface JobFrame {
  status: string;
  progress: { saved: number; total: number } | null;
  summary: unknown;
  error: string | null;
}

/**
 * Connect to a job's per-job WebSocket and resolve the terminal frame — the
 * exact stream the backfill modal subscribes to.
 */
function streamToTerminal(baseUrl: string, id: string, jobId: string): Promise<JobFrame> {
  const wsUrl = `${baseUrl.replace('http', 'ws')}/symbols/${id}/backfill/jobs/${jobId}/progress`;
  const socket = new WebSocket(wsUrl);
  return new Promise<JobFrame>((resolve, reject) => {
    socket.addEventListener('error', () => reject(new Error('ws failed to open')));
    socket.addEventListener('message', (event) => {
      const frame = JSON.parse(String(event.data)) as JobFrame;
      if (frame.status === 'succeeded' || frame.status === 'failed') {
        socket.close();
        resolve(frame);
      }
    });
  });
}

/**
 * E2E for the backfill UI's HTTP + WebSocket contract — the same Fastify app
 * the browser hits, over real Mongo (Testcontainers) with a stub source.
 * Traces the round-trip the modal drives (`POST` start → per-job WS stream →
 * terminal frame) and its critical failure mode, per `specs/backfill-ui.spec.md`.
 */
describe('backfill UI contract (e2e)', () => {
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

  it('starts a backfill and streams it over the per-job WebSocket to a success summary', async () => {
    await app.inject({ method: 'POST', url: '/symbols', payload: { id: BTC.id } });
    const started = await app.inject({
      method: 'POST',
      url: `/symbols/${BTC.id}/backfill`,
      payload: { period: '1h' },
    });
    const job = started.json() as { id: string; status: string };
    const terminal = await streamToTerminal(baseUrl, BTC.id, job.id);

    expect({
      startStatus: started.statusCode,
      startJobStatus: job.status,
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

  it('streams a failed frame carrying the upstream error (the modal’s retry path)', async () => {
    const db = client.db('lametrader-backfill-ui-fail');
    const failing: MarketDataSource = {
      types: [SymbolType.Crypto],
      periods: [Period.OneHour],
      search: async () => [],
      lookup: async () => BTC,
      fetchCandles: async (): Promise<CandleBatch> => {
        throw new MarketDataError('Binance failed to fetch candles for crypto:BTCUSDT: 418');
      },
    };
    const config = new ConfigService(new MongoConfigRepository(db));
    const candleRepo = new MongoCandleRepository(db);
    const watchlist = new MongoWatchlistRepository(db);
    await watchlist.add({ ...BTC, periods: [Period.OneHour] });
    const registry = defaultIndicators();
    const failApp = createApp({
      config,
      symbols: new SymbolService([failing], watchlist, config, candleRepo),
      backfill: new BackfillService([failing], candleRepo, watchlist),
      indicators: {
        registry,
        compute: new IndicatorService(registry, watchlist, candleRepo),
      },
    });
    const failUrl = await failApp.listen({ port: 0, host: '127.0.0.1' });

    try {
      const started = await failApp.inject({
        method: 'POST',
        url: `/symbols/${BTC.id}/backfill`,
        payload: { period: '1h' },
      });
      const job = started.json() as { id: string };
      const terminal = await streamToTerminal(failUrl, BTC.id, job.id);

      expect({ status: terminal.status, error: terminal.error }).toEqual({
        status: 'failed',
        error: 'Binance failed to fetch candles for crypto:BTCUSDT: 418',
      });
    } finally {
      await failApp.close();
      await db.dropDatabase();
    }
  });
});
