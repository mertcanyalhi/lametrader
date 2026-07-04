import { Period, SymbolType, type WatchedSymbol } from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DomainExceptionFilter } from '../common/domain-exception.filter.js';
import { buildValidationPipe } from '../common/validation.pipe.js';
import { InMemoryWatchlistRepository } from '../market/persistence/in-memory-watchlist.repository.js';
import { ProfilesController } from './controllers/profiles.controller.js';
import { defaultIndicators } from './indicators/default-indicators.js';
import { InMemoryProfileRepository } from './persistence/in-memory-profile.repository.js';
import { ProfileService } from './services/profile.service.js';

/**
 * Local (Docker-free) integration proof of the `/profiles` HTTP contract: the
 * {@link ProfilesController} behind the real global validation pipe and exception
 * filter, over in-memory profile / watchlist stores and the default indicator
 * registry. Pins routes, verbs, status codes, and payload shapes for every
 * in-scope route so the container-backed e2e tier only has to prove the Mongo
 * wiring. Ids and timestamps are made deterministic so full payloads can be
 * asserted.
 */
describe('profiles HTTP contract (integration)', () => {
  /** A watched crypto symbol available for `symbols`-scope tests. */
  const BTC: WatchedSymbol = {
    id: 'crypto:BTCUSDT',
    type: SymbolType.Crypto,
    description: 'Bitcoin / TetherUS',
    exchange: 'Binance',
    currency: 'USDT',
    periods: [Period.OneHour, Period.OneDay],
  };

  let app: INestApplication;

  /** Deterministic id generator: p1, p2, … */
  function sequentialIds(): () => string {
    let n = 0;
    return () => `p${++n}`;
  }

  /** Build the app over in-memory stores with a fixed clock + deterministic ids. */
  async function buildApp(
    opts: { watchlistSeed?: WatchedSymbol[] } = {},
  ): Promise<INestApplication> {
    const profiles = new InMemoryProfileRepository();
    const watchlist = new InMemoryWatchlistRepository(opts.watchlistSeed ?? []);
    const service = new ProfileService(profiles, watchlist, defaultIndicators(), {
      newId: sequentialIds(),
      now: () => 1000,
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [ProfilesController],
      providers: [{ provide: ProfileService, useValue: service }],
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

  it('GET /profiles returns an empty list when none exist', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer()).get('/profiles');
    expect({ status: res.status, body: res.body }).toEqual({ status: 200, body: [] });
  });

  it('POST /profiles creates a profile and returns 201 with the full defaulted payload', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer()).post('/profiles').send({ name: 'Scalper' });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 201,
      body: {
        id: 'p1',
        name: 'Scalper',
        description: '',
        enabled: true,
        scope: { type: 'all' },
        createdAt: 1000,
        updatedAt: 1000,
        indicators: [],
        chartStates: [],
      },
    });
  });

  it('POST /profiles persists a symbols scope over a watched id and returns it verbatim', async () => {
    app = await buildApp({ watchlistSeed: [BTC] });
    const res = await request(app.getHttpServer())
      .post('/profiles')
      .send({ name: 'Subset', scope: { type: 'symbols', symbolIds: [BTC.id] } });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 201,
      body: {
        id: 'p1',
        name: 'Subset',
        description: '',
        enabled: true,
        scope: { type: 'symbols', symbolIds: [BTC.id] },
        createdAt: 1000,
        updatedAt: 1000,
        indicators: [],
        chartStates: [],
      },
    });
  });

  it('GET /profiles/:id returns the profile', async () => {
    app = await buildApp();
    await request(app.getHttpServer()).post('/profiles').send({ name: 'Scalper' });
    const res = await request(app.getHttpServer()).get('/profiles/p1');
    expect({ status: res.status, id: res.body.id, name: res.body.name }).toEqual({
      status: 200,
      id: 'p1',
      name: 'Scalper',
    });
  });

  it('GET /profiles/:id returns 404 { error } for an unknown id', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer()).get('/profiles/ghost');
    expect({ status: res.status, body: res.body }).toEqual({
      status: 404,
      body: { error: 'profile not found: ghost' },
    });
  });

  it('PUT /profiles/:id fully replaces the profile and returns 200', async () => {
    app = await buildApp();
    await request(app.getHttpServer()).post('/profiles').send({ name: 'Scalper' });
    const res = await request(app.getHttpServer())
      .put('/profiles/p1')
      .send({ name: 'Swing', description: 'slow' });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: {
        id: 'p1',
        name: 'Swing',
        description: 'slow',
        enabled: true,
        scope: { type: 'all' },
        createdAt: 1000,
        updatedAt: 1000,
        indicators: [],
        chartStates: [],
      },
    });
  });

  it('PATCH /profiles/:id updates only the given fields and returns 200', async () => {
    app = await buildApp();
    await request(app.getHttpServer()).post('/profiles').send({ name: 'Scalper' });
    const res = await request(app.getHttpServer()).patch('/profiles/p1').send({ enabled: false });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: {
        id: 'p1',
        name: 'Scalper',
        description: '',
        enabled: false,
        scope: { type: 'all' },
        createdAt: 1000,
        updatedAt: 1000,
        indicators: [],
        chartStates: [],
      },
    });
  });

  it('DELETE /profiles/:id removes the profile and returns 204', async () => {
    app = await buildApp();
    await request(app.getHttpServer()).post('/profiles').send({ name: 'Scalper' });
    const res = await request(app.getHttpServer()).delete('/profiles/p1');
    expect({ status: res.status, body: res.body }).toEqual({ status: 204, body: {} });
  });

  it('DELETE /profiles/:id returns 404 for an unknown id', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer()).delete('/profiles/ghost');
    expect({ status: res.status, body: res.body }).toEqual({
      status: 404,
      body: { error: 'profile not found: ghost' },
    });
  });

  it('POST /profiles rejects a duplicate name with a 409 { error }', async () => {
    app = await buildApp();
    await request(app.getHttpServer()).post('/profiles').send({ name: 'Scalper' });
    const res = await request(app.getHttpServer()).post('/profiles').send({ name: 'Scalper' });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 409,
      body: { error: 'profile name already in use: Scalper' },
    });
  });

  it('POST /profiles rejects a symbols scope referencing an unwatched id with a domain 400', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer())
      .post('/profiles')
      .send({ name: 'Subset', scope: { type: 'symbols', symbolIds: ['crypto:ETHUSDT'] } });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 400,
      body: { error: 'symbol not watched: crypto:ETHUSDT' },
    });
  });

  it('POST /profiles rejects a missing name with the { error, fields } validation envelope', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer()).post('/profiles').send({});
    expect({
      status: res.status,
      error: res.body.error,
      paths: res.body.fields.map((f: { path: string }) => f.path),
    }).toEqual({ status: 400, error: 'Validation failed', paths: ['name'] });
  });

  it('POST /profiles rejects an unknown property with the validation envelope', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer()).post('/profiles').send({ name: 'X', bogus: 1 });
    expect({
      status: res.status,
      error: res.body.error,
      paths: res.body.fields.map((f: { path: string }) => f.path),
    }).toEqual({ status: 400, error: 'Validation failed', paths: ['bogus'] });
  });

  it('POST /profiles rejects a bad scope enum with the nested validation path', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer())
      .post('/profiles')
      .send({ name: 'X', scope: { type: 'bogus' } });
    expect({
      status: res.status,
      error: res.body.error,
      paths: res.body.fields.map((f: { path: string }) => f.path),
    }).toEqual({ status: 400, error: 'Validation failed', paths: ['scope.type'] });
  });

  it('POST /profiles/:id/indicators attaches an instance and returns 201 with the enriched payload', async () => {
    app = await buildApp();
    await request(app.getHttpServer()).post('/profiles').send({ name: 'Scalper' });
    const res = await request(app.getHttpServer())
      .post('/profiles/p1/indicators')
      .send({ indicatorKey: 'sma', inputs: { length: 5 }, label: 'Fast' });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 201,
      body: {
        id: 'p2',
        indicatorKey: 'sma',
        version: 1,
        inputs: { length: 5, source: 'close' },
        label: 'Fast',
        summary: 'SMA 5 close',
      },
    });
  });

  it('GET /profiles/:id/indicators lists the attached instances', async () => {
    app = await buildApp();
    await request(app.getHttpServer()).post('/profiles').send({ name: 'Scalper' });
    await request(app.getHttpServer())
      .post('/profiles/p1/indicators')
      .send({ indicatorKey: 'sma' });
    const res = await request(app.getHttpServer()).get('/profiles/p1/indicators');
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: [
        {
          id: 'p2',
          indicatorKey: 'sma',
          version: 1,
          inputs: { length: 14, source: 'close' },
          summary: 'SMA 14 close',
        },
      ],
    });
  });

  it('GET /profiles/:id/indicators/:instanceId returns one instance', async () => {
    app = await buildApp();
    await request(app.getHttpServer()).post('/profiles').send({ name: 'Scalper' });
    await request(app.getHttpServer())
      .post('/profiles/p1/indicators')
      .send({ indicatorKey: 'sma' });
    const res = await request(app.getHttpServer()).get('/profiles/p1/indicators/p2');
    expect({ status: res.status, key: res.body.indicatorKey, summary: res.body.summary }).toEqual({
      status: 200,
      key: 'sma',
      summary: 'SMA 14 close',
    });
  });

  it('PUT /profiles/:id/indicators/:instanceId replaces an instance and returns 200', async () => {
    app = await buildApp();
    await request(app.getHttpServer()).post('/profiles').send({ name: 'Scalper' });
    await request(app.getHttpServer())
      .post('/profiles/p1/indicators')
      .send({ indicatorKey: 'sma' });
    const res = await request(app.getHttpServer())
      .put('/profiles/p1/indicators/p2')
      .send({ indicatorKey: 'sma', inputs: { length: 21 } });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: {
        id: 'p2',
        indicatorKey: 'sma',
        version: 1,
        inputs: { length: 21, source: 'close' },
        summary: 'SMA 21 close',
      },
    });
  });

  it('DELETE /profiles/:id/indicators/:instanceId detaches an instance and returns 204', async () => {
    app = await buildApp();
    await request(app.getHttpServer()).post('/profiles').send({ name: 'Scalper' });
    await request(app.getHttpServer())
      .post('/profiles/p1/indicators')
      .send({ indicatorKey: 'sma' });
    const res = await request(app.getHttpServer()).delete('/profiles/p1/indicators/p2');
    expect({ status: res.status, body: res.body }).toEqual({ status: 204, body: {} });
  });

  it('POST /profiles/:id/indicators rejects an unknown indicatorKey with a domain 400', async () => {
    app = await buildApp();
    await request(app.getHttpServer()).post('/profiles').send({ name: 'Scalper' });
    const res = await request(app.getHttpServer())
      .post('/profiles/p1/indicators')
      .send({ indicatorKey: 'bogus' });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 400,
      body: { error: 'unknown indicator: bogus' },
    });
  });

  it('POST /profiles/:id/indicators returns 404 for an unknown profile', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer())
      .post('/profiles/ghost/indicators')
      .send({ indicatorKey: 'sma' });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 404,
      body: { error: 'profile not found: ghost' },
    });
  });

  it('GET /profiles/:id/indicators/:instanceId returns 404 for an unknown instance', async () => {
    app = await buildApp();
    await request(app.getHttpServer()).post('/profiles').send({ name: 'Scalper' });
    const res = await request(app.getHttpServer()).get('/profiles/p1/indicators/ghost');
    expect({ status: res.status, body: res.body }).toEqual({
      status: 404,
      body: { error: 'indicator instance not found: ghost (profile p1)' },
    });
  });
});
