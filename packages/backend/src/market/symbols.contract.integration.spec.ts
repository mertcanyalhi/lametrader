import {
  type Config,
  ConfigKey,
  type Instrument,
  Period,
  type SymbolDiscovery,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DomainExceptionFilter } from '../common/domain-exception.filter.js';
import { InMemoryConfigRepository } from '../common/persistence/in-memory-config.repository.js';
import { ConfigService } from '../common/services/config.service.js';
import { buildValidationPipe } from '../common/validation.pipe.js';
import { SymbolsController } from './controllers/symbols.controller.js';
import { InMemoryMarketDataSource } from './market-data/in-memory-market-data-source.js';
import { InMemoryCandleRepository } from './persistence/in-memory-candle.repository.js';
import { InMemoryWatchlistRepository } from './persistence/in-memory-watchlist.repository.js';
import { SymbolService } from './services/symbol.service.js';

/**
 * Local (Docker-free) integration proof of the symbols + instruments HTTP
 * contract: the {@link SymbolsController} behind the real global validation pipe
 * and exception filter, over in-memory sources / watchlist / candles. Pins
 * routes, verbs, status codes, and payload shapes for every in-scope route so
 * the container-backed e2e tier only has to prove the Mongo wiring.
 */
describe('symbols + instruments HTTP contract (integration)', () => {
  const BTC: Instrument = {
    id: 'crypto:BTCUSDT',
    type: SymbolType.Crypto,
    description: 'Bitcoin / TetherUS',
    exchange: 'Binance',
    currency: 'USDT',
  };
  const AAPL: Instrument = {
    id: 'stock:AAPL',
    type: SymbolType.Stock,
    description: 'Apple Inc.',
    exchange: 'NMS',
  };

  let app: INestApplication;

  /** Build the app over in-memory stores, with the given sources / seed / config. */
  async function buildApp(
    opts: { sources?: SymbolDiscovery[]; watchlistSeed?: WatchedSymbol[]; config?: Config } = {},
  ): Promise<INestApplication> {
    const seed = opts.config
      ? ([
          [ConfigKey.Periods, opts.config.periods],
          [ConfigKey.DefaultPeriod, opts.config.defaultPeriod],
        ] as const)
      : [];
    const config = new ConfigService(new InMemoryConfigRepository(seed));
    const watchlist = new InMemoryWatchlistRepository(opts.watchlistSeed ?? []);
    const candles = new InMemoryCandleRepository();
    const sources = opts.sources ?? [new InMemoryMarketDataSource([BTC])];
    const symbols = new SymbolService(sources, watchlist, config, candles);
    const moduleRef = await Test.createTestingModule({
      controllers: [SymbolsController],
      providers: [{ provide: SymbolService, useValue: symbols }],
    }).compile();
    const nestApp = moduleRef.createNestApplication();
    nestApp.useGlobalPipes(buildValidationPipe());
    nestApp.useGlobalFilters(new DomainExceptionFilter());
    await nestApp.init();
    return nestApp;
  }

  afterEach(async () => {
    await app?.close();
  });

  it('GET /instruments discovers instruments matching the query', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer()).get('/instruments?q=bitcoin');
    expect({ status: res.status, body: res.body }).toEqual({ status: 200, body: [BTC] });
  });

  it('GET /instruments filters to one asset class when type is given', async () => {
    app = await buildApp({
      sources: [new InMemoryMarketDataSource([BTC]), new InMemoryMarketDataSource([AAPL])],
    });
    const res = await request(app.getHttpServer()).get('/instruments?q=a&type=stock');
    expect({ status: res.status, body: res.body }).toEqual({ status: 200, body: [AAPL] });
  });

  it('GET /symbols returns an empty list when nothing is watched', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer()).get('/symbols');
    expect({ status: res.status, body: res.body }).toEqual({ status: 200, body: [] });
  });

  it('POST /symbols adds a symbol and returns 201 with the default periods', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer()).post('/symbols').send({ id: BTC.id });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 201,
      body: { ...BTC, periods: ['1h', '1d'] },
    });
  });

  it('GET /symbols lists the watched symbols', async () => {
    app = await buildApp({ watchlistSeed: [{ ...BTC, periods: [Period.OneHour, Period.OneDay] }] });
    const res = await request(app.getHttpServer()).get('/symbols');
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: [{ ...BTC, periods: ['1h', '1d'] }],
    });
  });

  it('GET /symbols?enrich=true attaches a null quote when no candles are stored', async () => {
    app = await buildApp({ watchlistSeed: [{ ...BTC, periods: [Period.OneHour, Period.OneDay] }] });
    const res = await request(app.getHttpServer()).get('/symbols?enrich=true');
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: [{ ...BTC, periods: ['1h', '1d'], quote: null }],
    });
  });

  it('POST /symbols rejects a non-existent symbol with a 404 { error }', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer()).post('/symbols').send({ id: 'crypto:NOPEUSDT' });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 404,
      body: { error: 'symbol not found: crypto:NOPEUSDT' },
    });
  });

  it('POST /symbols rejects re-adding a watched symbol with a 409 { error }', async () => {
    app = await buildApp({ watchlistSeed: [{ ...BTC, periods: [Period.OneHour] }] });
    const res = await request(app.getHttpServer()).post('/symbols').send({ id: BTC.id });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 409,
      body: { error: 'symbol already watched: crypto:BTCUSDT' },
    });
  });

  it('POST /symbols rejects a period the source cannot serve with a domain 400', async () => {
    app = await buildApp({
      sources: [
        new InMemoryMarketDataSource(
          [BTC],
          [SymbolType.Crypto],
          [],
          [Period.OneHour, Period.OneDay],
        ),
      ],
      config: {
        periods: [Period.OneHour, Period.FourHours, Period.OneDay],
        defaultPeriod: Period.OneHour,
      },
    });
    const res = await request(app.getHttpServer())
      .post('/symbols')
      .send({ id: BTC.id, periods: ['4h'] });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 400,
      body: { error: 'source does not support period(s): 4h' },
    });
  });

  it('POST /symbols rejects a bad enum period with the { error, fields } validation envelope', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer())
      .post('/symbols')
      .send({ id: BTC.id, periods: ['bogus'] });
    expect({
      status: res.status,
      error: res.body.error,
      paths: res.body.fields.map((f: { path: string }) => f.path),
    }).toEqual({ status: 400, error: 'Validation failed', paths: ['periods'] });
  });

  it('POST /symbols rejects a missing id with the validation envelope', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer()).post('/symbols').send({});
    expect({
      status: res.status,
      error: res.body.error,
      paths: res.body.fields.map((f: { path: string }) => f.path),
    }).toEqual({ status: 400, error: 'Validation failed', paths: ['id'] });
  });

  it('POST /symbols rejects an unknown property with the validation envelope', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer()).post('/symbols').send({ id: BTC.id, bogus: 1 });
    expect({
      status: res.status,
      error: res.body.error,
      paths: res.body.fields.map((f: { path: string }) => f.path),
    }).toEqual({ status: 400, error: 'Validation failed', paths: ['bogus'] });
  });

  it('PATCH /symbols/:id changes a watched symbol’s periods and returns 200', async () => {
    app = await buildApp({ watchlistSeed: [{ ...BTC, periods: [Period.OneHour, Period.OneDay] }] });
    const res = await request(app.getHttpServer())
      .patch(`/symbols/${BTC.id}`)
      .send({ periods: ['1h'] });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: { ...BTC, periods: ['1h'] },
    });
  });

  it('PATCH /symbols/:id returns 404 for an unwatched symbol', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer())
      .patch('/symbols/crypto:BTCUSDT')
      .send({ periods: ['1h'] });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 404,
      body: { error: 'symbol not watched: crypto:BTCUSDT' },
    });
  });

  it('DELETE /symbols/:id removes a watched symbol and returns 204', async () => {
    app = await buildApp({ watchlistSeed: [{ ...BTC, periods: [Period.OneHour] }] });
    const res = await request(app.getHttpServer()).delete(`/symbols/${BTC.id}`);
    expect({ status: res.status, body: res.body }).toEqual({ status: 204, body: {} });
  });
});
