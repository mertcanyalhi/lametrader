import {
  type Candle,
  type CandleRepository,
  type IndicatorComputeResult,
  type Instrument,
  Period,
  SymbolType,
  type WatchedSymbol,
  type WatchlistRepository,
} from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { CandleEntry } from '../src/candles/candle-entry.schema.js';
import { CANDLE_REPOSITORY } from '../src/candles/candle-repository.token.js';
import { movingAverage } from '../src/indicators/sma.js';
import { volumeWeightedMovingAverage } from '../src/indicators/vwma.js';
import { InMemoryMarketDataSource } from '../src/market-data/in-memory-market-data-source.js';
import { MARKET_DATA_SOURCES } from '../src/market-data/market-data-source.token.js';
import { WatchlistEntry } from '../src/watchlist/watchlist-entry.schema.js';
import { WATCHLIST_REPOSITORY } from '../src/watchlist/watchlist-repository.token.js';

/** The stub instruments the catalog knows (never hit — candles are seeded directly). */
const BTC_INSTRUMENT: Instrument = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'Bitcoin / TetherUS',
  exchange: 'Binance',
  currency: 'USDT',
};

/** A watched crypto symbol the compute route reads candles for. */
const BTC: WatchedSymbol = { ...BTC_INSTRUMENT, periods: [Period.OneHour] };

/** A watched FX symbol, for the asset-class-mismatch 400 (FX + vwma). */
const EURUSD: WatchedSymbol = {
  id: 'fx:EURUSD',
  type: SymbolType.Fx,
  description: 'Euro / USD',
  exchange: 'OANDA',
  currency: 'USD',
  periods: [Period.OneHour],
};

/** Build a crypto candle at `time` with the given close. */
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

/**
 * E2E for the indicator catalog AND the symbol-scoped compute route from the API
 * consumer's perspective: the real Nest app over a real Mongo (Testcontainers),
 * with an in-memory stub market-data source substituted for the defaults. The
 * watchlist and a V-shaped BTC candle series are seeded straight into Mongo via
 * the shared repositories, then the routes are driven over HTTP. Exercises both
 * reference indicators' descriptor round-trip, the warm-from-earliest compute
 * behavior, a fired VWMA buy signal, and the 404 / 400 failure modes. Mirrors
 * the old Fastify `indicators.e2e.test.ts`.
 */
describe('indicators API (e2e)', () => {
  let container: StartedMongoDBContainer;
  let app: INestApplication;
  let watchlistModel: Model<WatchlistEntry>;
  let candleModel: Model<CandleEntry>;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    process.env.MONGODB_URI = `${container.getConnectionString()}/?directConnection=true`;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MARKET_DATA_SOURCES)
      .useValue([new InMemoryMarketDataSource([BTC_INSTRUMENT])])
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    watchlistModel = app.get<Model<WatchlistEntry>>(getModelToken(WatchlistEntry.name));
    candleModel = app.get<Model<CandleEntry>>(getModelToken(CandleEntry.name));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  beforeEach(async () => {
    await watchlistModel.deleteMany({});
    await candleModel.deleteMany({});
    const watchlist = app.get<WatchlistRepository>(WATCHLIST_REPOSITORY);
    const candles = app.get<CandleRepository>(CANDLE_REPOSITORY);
    await watchlist.add(BTC);
    await watchlist.add(EURUSD);
    // A V-shape close series so VWMA dips below the line then crosses back up.
    await candles.save(
      BTC.id,
      Period.OneHour,
      [10, 8, 6, 10, 14].map((c, i) => cryptoCandle(i, c)),
    );
  });

  it('GET /indicators returns the full catalog with both reference indicators', async () => {
    const res = await request(app.getHttpServer()).get('/indicators');
    const byKey = Object.fromEntries(
      (res.body as { key: string }[]).map((definition) => [definition.key, definition]),
    );
    expect({ status: res.status, byKey }).toEqual({
      status: 200,
      byKey: {
        sma: movingAverage.definition,
        vwma: volumeWeightedMovingAverage.definition,
      },
    });
  });

  it('GET /indicators/sma returns the moving-average definition', async () => {
    const res = await request(app.getHttpServer()).get('/indicators/sma');
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: movingAverage.definition,
    });
  });

  it('GET /indicators/vwma returns the VWMA definition', async () => {
    const res = await request(app.getHttpServer()).get('/indicators/vwma');
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: volumeWeightedMovingAverage.definition,
    });
  });

  it('GET /indicators/:key returns 404 { error } for an unknown key', async () => {
    const res = await request(app.getHttpServer()).get('/indicators/unknown-key');
    expect({ status: res.status, body: res.body }).toEqual({
      status: 404,
      body: { error: 'indicator not found: unknown-key' },
    });
  });

  it('GET /symbols/:id/indicators/sma computes the warm SMA series over real Mongo candles', async () => {
    const res = await request(app.getHttpServer()).get(
      `/symbols/${BTC.id}/indicators/sma?period=1h&length=3&source=close`,
    );
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: {
        indicatorKey: 'sma',
        version: 1,
        period: '1h',
        state: [
          { time: 0, value: null },
          { time: 1, value: null },
          { time: 2, value: expect.closeTo(8, 6) },
          { time: 3, value: expect.closeTo(8, 6) },
          { time: 4, value: expect.closeTo(10, 6) },
        ],
      },
    });
  });

  it('GET /symbols/:id/indicators/vwma fires at least one buy signal', async () => {
    const res = await request(app.getHttpServer()).get(
      `/symbols/${BTC.id}/indicators/vwma?period=1h&length=3&multiplier=1&direction=both`,
    );
    const body = res.body as IndicatorComputeResult;
    const buySignals = body.state.filter((row) => row.signal === 'buy');
    expect({
      status: res.status,
      indicatorKey: body.indicatorKey,
      hasBuySignal: buySignals.length >= 1,
    }).toEqual({ status: 200, indicatorKey: 'vwma', hasBuySignal: true });
  });

  it('GET /symbols/:id/indicators/:key returns 400 on an asset-class mismatch (FX + vwma)', async () => {
    const res = await request(app.getHttpServer()).get(
      `/symbols/${EURUSD.id}/indicators/vwma?period=1h&multiplier=1&direction=both`,
    );
    expect({ status: res.status, error: res.body.error }).toEqual({
      status: 400,
      error: 'indicator "vwma" does not apply to fx symbols',
    });
  });

  it('GET /symbols/:id/indicators/:key returns 404 when the symbol is not watched', async () => {
    const res = await request(app.getHttpServer()).get(
      '/symbols/crypto:UNWATCHED/indicators/sma?period=1h&length=3',
    );
    expect({ status: res.status, body: res.body }).toEqual({
      status: 404,
      body: { error: 'symbol not watched: crypto:UNWATCHED' },
    });
  });

  it('GET /symbols/:id/indicators/sma with `?from=&to=` returns only the warm rows inside the window', async () => {
    const res = await request(app.getHttpServer()).get(
      `/symbols/${BTC.id}/indicators/sma?period=1h&from=3&to=5&length=3&source=close`,
    );
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: {
        indicatorKey: 'sma',
        version: 1,
        period: '1h',
        state: [
          { time: 3, value: expect.closeTo(8, 6) },
          { time: 4, value: expect.closeTo(10, 6) },
        ],
      },
    });
  });

  it("GET /symbols/:id/indicators/sma surfaces leading-null rows when history doesn't reach warm-up", async () => {
    const res = await request(app.getHttpServer()).get(
      `/symbols/${BTC.id}/indicators/sma?period=1h&from=3&to=5&length=10&source=close`,
    );
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: {
        indicatorKey: 'sma',
        version: 1,
        period: '1h',
        state: [
          { time: 3, value: null },
          { time: 4, value: null },
        ],
      },
    });
  });
});
