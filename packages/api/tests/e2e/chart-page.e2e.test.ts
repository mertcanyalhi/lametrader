import { createApp } from '@lametrader/api';
import { type CryptoCandle, type Instrument, Period, SymbolType } from '@lametrader/core';
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
 * E2E for the chart page's candle-read contract — the same `GET /symbols/:id/candles`
 * the browser's `usePagedCandles` hook drives, over real Mongo (Testcontainers)
 * with a stub source, per `specs/web-chart-page.spec.md`.
 *
 * The chart loads by time window (`?from=&to=`); a window covering the data
 * returns the ascending candles, and a window with nothing stored returns an
 * empty page — the signal the UI renders as the "Run backfill" empty state (and
 * its scroll-back stop condition), not an error.
 */
describe('chart page candle contract (e2e)', () => {
  let container: StartedMongoDBContainer;
  let client: MongoClient;
  let app: FastifyInstance;

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
    await app.ready();
  });

  /** GET a candle window and return its decoded page. */
  async function readCandles(
    query: string,
  ): Promise<{ candles: CryptoCandle[]; nextCursor: number | null; latestTime: number | null }> {
    const read = await app.inject({ method: 'GET', url: `/symbols/${BTC.id}/candles?${query}` });
    return read.json() as {
      candles: CryptoCandle[];
      nextCursor: number | null;
      latestTime: number | null;
    };
  }

  afterAll(async () => {
    await app?.close();
    await client?.close();
    await container?.stop();
  });

  /**
   * Add BTC and run its async 1h backfill, polling the candle window until the
   * series is persisted (no sleeps — a condition poll, per the test conventions).
   */
  async function backfillBtc(): Promise<void> {
    await app.inject({ method: 'POST', url: '/symbols', payload: { id: BTC.id } });
    await app.inject({
      method: 'POST',
      url: `/symbols/${BTC.id}/backfill`,
      payload: { period: '1h' },
    });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const page = await readCandles('period=1h&from=0&to=4000');
      if (page.candles.length === SERIES.length) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('backfill did not persist candles in time');
  }

  it('returns the window’s candles ascending by time for a window covering the data', async () => {
    await backfillBtc();

    const read = await app.inject({
      method: 'GET',
      url: `/symbols/${BTC.id}/candles?period=1h&from=0&to=4000`,
    });

    expect({ status: read.statusCode, body: read.json() }).toEqual({
      status: 200,
      body: { candles: SERIES, nextCursor: null, latestTime: 3000 },
    });
  });

  it('returns an empty page carrying latestTime when history exists outside the window (re-anchor signal, issue #70)', async () => {
    const read = await app.inject({
      method: 'GET',
      url: `/symbols/${BTC.id}/candles?period=1h&from=100000&to=200000`,
    });

    // candles empty for this window, but latestTime points at the stored history
    // elsewhere — the UI re-anchors to it instead of showing "No candles yet".
    expect({ status: read.statusCode, body: read.json() }).toEqual({
      status: 200,
      body: { candles: [], nextCursor: null, latestTime: 3000 },
    });
  });
});
