import { createApp } from '@lametrader/api';
import {
  type Candle,
  type IndicatorComputeResult,
  type IndicatorDefinition,
  Period,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import {
  ConfigService,
  defaultIndicators,
  IndicatorComputeService,
  MongoCandleRepository,
  MongoWatchlistRepository,
  movingAverage,
  volumeWeightedMovingAverage,
} from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { FastifyInstance } from 'fastify';
import { type Db, MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * E2E for the indicator catalog AND the symbol-scoped compute route over real
 * Mongo + the real `defaultIndicators()` registry.
 *
 * Closes the deferred end-to-end coverage from #12 and #13:
 * - catalog/serialization surface — both reference indicators round-trip over real HTTP.
 * - compute/correctness surface — real Mongo-backed candles are fed through the compute service for both reference indicators, asserting warm-from-earliest behavior and the firing of at least one buy signal on VWMA.
 */
describe('indicators API (e2e)', () => {
  const BTC: WatchedSymbol = {
    id: 'crypto:BTCUSDT',
    type: SymbolType.Crypto,
    description: 'Bitcoin / TetherUS',
    exchange: 'Binance',
    currency: 'USDT',
    periods: [Period.OneHour],
  };
  const EURUSD: WatchedSymbol = {
    id: 'fx:EURUSD',
    type: SymbolType.Fx,
    description: 'Euro / USD',
    exchange: 'OANDA',
    currency: 'USD',
    periods: [Period.OneHour],
  };

  const cryptoCandle = (time: number, close: number, volume = 10): Candle => ({
    type: SymbolType.Crypto,
    time,
    open: close,
    high: close,
    low: close,
    close,
    volume,
    quoteVolume: close * volume,
    trades: 1,
  });

  let container: StartedMongoDBContainer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    client = new MongoClient(`${container.getConnectionString()}?directConnection=true`);
    await client.connect();
    db = client.db('lametrader');

    const config = new ConfigService({
      load: async () => db.collection('config').findOne({ _id: 'singleton' as never }) as never,
      save: async () => {
        /* unused */
      },
    });
    const indicators = defaultIndicators();
    const watchlist = new MongoWatchlistRepository(db);
    const candles = new MongoCandleRepository(db);
    await candles.ensureIndexes();
    const indicatorCompute = new IndicatorComputeService(indicators, watchlist, candles);

    // Seed: watch BTC and EURUSD; store five crypto candles for the compute path.
    await watchlist.add(BTC);
    await watchlist.add(EURUSD);
    await candles.save(
      BTC.id,
      Period.OneHour,
      [10, 20, 30, 40, 50].map((c, i) => cryptoCandle(i, c, 10)),
    );

    app = createApp({ config, indicators, indicatorCompute });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await client?.close();
    await container?.stop();
  });

  it('GET /indicators returns the full catalog with both reference indicators', async () => {
    const res = await app.inject({ method: 'GET', url: '/indicators' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as IndicatorDefinition[];
    const byKey = Object.fromEntries(body.map((d) => [d.key, d]));
    expect(byKey).toEqual({
      sma: movingAverage.definition,
      vwma: volumeWeightedMovingAverage.definition,
    });
  });

  it('GET /indicators/sma returns the moving-average definition', async () => {
    const res = await app.inject({ method: 'GET', url: '/indicators/sma' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(movingAverage.definition);
  });

  it('GET /indicators/vwma returns the VWMA definition (covers #13 enum/markers/separate surface)', async () => {
    const res = await app.inject({ method: 'GET', url: '/indicators/vwma' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(volumeWeightedMovingAverage.definition);
  });

  it('GET /indicators/unknown-key returns 404 with { error }', async () => {
    const res = await app.inject({ method: 'GET', url: '/indicators/unknown-key' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'indicator not found: unknown-key' });
  });

  it('GET /symbols/:id/indicators/sma computes the warm SMA series over real Mongo candles', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/symbols/${BTC.id}/indicators/sma?period=1h&length=3&source=close`,
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

  it('GET /symbols/:id/indicators/vwma fires at least one buy signal (closes #13 compute gap)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/symbols/${BTC.id}/indicators/vwma?period=1h&length=3&multiplier=1&direction=both`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as IndicatorComputeResult;
    expect(body.indicatorKey).toBe('vwma');
    // The seeded series rises monotonically 10→50; the first up-cross past warm-up
    // emits a buy signal.
    const buySignals = body.state.filter((row) => row.signal === 'buy');
    expect(buySignals.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /symbols/:id/indicators/:key returns 400 on asset-class mismatch (FX + vwma)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/symbols/${EURUSD.id}/indicators/vwma?period=1h&multiplier=1&direction=both`,
    });
    expect(res.statusCode).toBe(400);
  });
});
