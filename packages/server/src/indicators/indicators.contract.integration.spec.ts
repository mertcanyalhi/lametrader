import {
  type Candle,
  type IndicatorComputeResult,
  Period,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { InMemoryCandleRepository } from '../candles/in-memory-candle.repository.js';
import { DomainExceptionFilter } from '../common/domain-exception.filter.js';
import { buildValidationPipe } from '../common/validation.pipe.js';
import { InMemoryWatchlistRepository } from '../watchlist/in-memory-watchlist.repository.js';
import { defaultIndicators } from './default-indicators.js';
import { IndicatorService } from './indicator.service.js';
import { IndicatorRegistry } from './indicator-registry.js';
import { IndicatorsController } from './indicators.controller.js';
import { movingAverage } from './sma.js';
import { volumeWeightedMovingAverage } from './vwma.js';

/**
 * Local (Docker-free) integration proof of the indicator HTTP contract: the
 * {@link IndicatorsController} behind the real global validation pipe and
 * exception filter, over the default indicator registry and in-memory
 * watchlist / candle stores. Pins routes, verbs, status codes, and the exact
 * payload shapes (both the serialized definitions and the computed series) for
 * every in-scope route so the container-backed e2e tier only has to prove the
 * Mongo wiring. Mirrors the old Fastify `indicators.e2e.test.ts` (in-scope
 * routes only).
 */
describe('indicators HTTP contract (integration)', () => {
  /** A watched crypto symbol the compute route reads candles for. */
  const BTC: WatchedSymbol = {
    id: 'crypto:BTCUSDT',
    type: SymbolType.Crypto,
    description: 'Bitcoin / TetherUS',
    exchange: 'Binance',
    currency: 'USDT',
    periods: [Period.OneHour],
  };
  /** A watched FX symbol, for the asset-class-mismatch 400 (FX + vwma). */
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

  let app: INestApplication;

  /**
   * Build the app over the default registry + in-memory stores, seeded with BTC
   * and EURUSD watched and a V-shaped BTC series so VWMA fires a buy signal.
   */
  async function buildApp(): Promise<INestApplication> {
    const registry = defaultIndicators();
    const watchlist = new InMemoryWatchlistRepository([BTC, EURUSD]);
    const candles = new InMemoryCandleRepository();
    await candles.save(
      BTC.id,
      Period.OneHour,
      [10, 8, 6, 10, 14].map((c, i) => cryptoCandle(i, c)),
    );
    const service = new IndicatorService(registry, watchlist, candles);
    const moduleRef = await Test.createTestingModule({
      controllers: [IndicatorsController],
      providers: [
        { provide: IndicatorRegistry, useValue: registry },
        { provide: IndicatorService, useValue: service },
      ],
    }).compile();
    const nestApp = moduleRef.createNestApplication();
    nestApp.useGlobalPipes(buildValidationPipe());
    nestApp.useGlobalFilters(new DomainExceptionFilter());
    await nestApp.init();
    return nestApp;
  }

  beforeEach(async () => {
    app = await buildApp();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('GET /indicators returns the full catalog keyed by both reference indicators', async () => {
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

  it('GET /symbols/:id/indicators/sma computes the warm SMA series over stored candles', async () => {
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

  it('GET /symbols/:id/indicators/vwma fires at least one buy signal over the V-shaped series', async () => {
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

  it('GET /symbols/:id/indicators/sma with `?from=&to=` returns only rows inside the window, each already warm', async () => {
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

  it("GET /symbols/:id/indicators/sma surfaces leading-null rows when the stored history doesn't reach warm-up", async () => {
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
