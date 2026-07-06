import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DomainExceptionFilter } from '../../common/domain-exception.filter.js';
import { buildValidationPipe } from '../../common/validation.pipe.js';
import { BacktestStrategiesController } from './backtest-strategies.controller.js';
import { BacktestStrategyService } from './backtest-strategy.service.js';
import { InMemoryBacktestStrategyRepository } from './in-memory-backtest-strategy.repository.js';

/**
 * Local (Docker-free) integration proof of the `/backtest-strategies` HTTP
 * contract: the {@link BacktestStrategiesController} behind the real global
 * validation pipe and exception filter, over an in-memory strategy store. Pins
 * routes, verbs, status codes, and payload shapes for every route so the
 * container-backed e2e tier only has to prove the Mongo wiring. Ids and
 * timestamps are made deterministic so full payloads can be asserted.
 */
describe('backtest-strategies HTTP contract (integration)', () => {
  let app: INestApplication;

  /** Deterministic id generator: s1, s2, … */
  function sequentialIds(): () => string {
    let n = 0;
    return () => `s${++n}`;
  }

  /** A valid create body keyed to a `trend` state change with all exit mechanisms. */
  const body = (name: string) => ({
    name,
    entry: { signal: { key: 'trend', value: { type: 'string', value: 'up' } } },
    exit: {
      signal: { key: 'trend', value: { type: 'string', value: 'down' } },
      profitTarget: { kind: 'percentage', amount: 5 },
      stopLoss: { kind: 'fixed', amount: 10 },
    },
  });

  /** The full persisted payload the deterministic `body(name)` produces at id `s1`. */
  const persisted = (name: string) => ({
    id: 's1',
    name,
    description: '',
    entry: { signal: { key: 'trend', value: { type: 'string', value: 'up' } } },
    exit: {
      signal: { key: 'trend', value: { type: 'string', value: 'down' } },
      profitTarget: { kind: 'percentage', amount: 5 },
      stopLoss: { kind: 'fixed', amount: 10 },
    },
    createdAt: 1000,
    updatedAt: 1000,
  });

  /** Build the app over an in-memory store with a fixed clock + deterministic ids. */
  async function buildApp(): Promise<INestApplication> {
    const service = new BacktestStrategyService(new InMemoryBacktestStrategyRepository(), {
      newId: sequentialIds(),
      now: () => 1000,
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [BacktestStrategiesController],
      providers: [{ provide: BacktestStrategyService, useValue: service }],
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

  it('GET /backtest-strategies returns an empty list when none exist', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer()).get('/backtest-strategies');
    expect({ status: res.status, body: res.body }).toEqual({ status: 200, body: [] });
  });

  it('POST /backtest-strategies creates a strategy and returns 201 with the full payload', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer())
      .post('/backtest-strategies')
      .send(body('Breakout'));
    expect({ status: res.status, body: res.body }).toEqual({
      status: 201,
      body: persisted('Breakout'),
    });
  });

  it('GET /backtest-strategies/:id returns the strategy', async () => {
    app = await buildApp();
    await request(app.getHttpServer()).post('/backtest-strategies').send(body('Breakout'));
    const res = await request(app.getHttpServer()).get('/backtest-strategies/s1');
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: persisted('Breakout'),
    });
  });

  it('GET /backtest-strategies/:id returns 404 { error } for an unknown id', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer()).get('/backtest-strategies/ghost');
    expect({ status: res.status, body: res.body }).toEqual({
      status: 404,
      body: { error: 'backtest strategy not found: ghost' },
    });
  });

  it('PUT /backtest-strategies/:id fully replaces the strategy and returns 200', async () => {
    app = await buildApp();
    await request(app.getHttpServer()).post('/backtest-strategies').send(body('Breakout'));
    const res = await request(app.getHttpServer())
      .put('/backtest-strategies/s1')
      .send({
        name: 'Swing',
        description: 'slower',
        entry: { signal: { key: 'regime', value: { type: 'string', value: 'bull' } } },
        exit: { stopLoss: { kind: 'fixed', amount: 3 } },
      });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: {
        id: 's1',
        name: 'Swing',
        description: 'slower',
        entry: { signal: { key: 'regime', value: { type: 'string', value: 'bull' } } },
        exit: { stopLoss: { kind: 'fixed', amount: 3 } },
        createdAt: 1000,
        updatedAt: 1000,
      },
    });
  });

  it('DELETE /backtest-strategies/:id removes the strategy and returns 204', async () => {
    app = await buildApp();
    await request(app.getHttpServer()).post('/backtest-strategies').send(body('Breakout'));
    const res = await request(app.getHttpServer()).delete('/backtest-strategies/s1');
    expect({ status: res.status, body: res.body }).toEqual({ status: 204, body: {} });
  });

  it('DELETE /backtest-strategies/:id returns 404 for an unknown id', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer()).delete('/backtest-strategies/ghost');
    expect({ status: res.status, body: res.body }).toEqual({
      status: 404,
      body: { error: 'backtest strategy not found: ghost' },
    });
  });

  it('POST /backtest-strategies rejects a duplicate name with a 409 { error }', async () => {
    app = await buildApp();
    await request(app.getHttpServer()).post('/backtest-strategies').send(body('Breakout'));
    const res = await request(app.getHttpServer())
      .post('/backtest-strategies')
      .send(body('Breakout'));
    expect({ status: res.status, body: res.body }).toEqual({
      status: 409,
      body: { error: 'backtest strategy name already in use: Breakout' },
    });
  });

  it('POST /backtest-strategies rejects a missing entry signal with a domain 400', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer())
      .post('/backtest-strategies')
      .send({ name: 'No entry', exit: { profitTarget: { kind: 'fixed', amount: 1 } } });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 400,
      body: { error: 'entry signal is required' },
    });
  });

  it('POST /backtest-strategies rejects an empty exit with a domain 400', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer())
      .post('/backtest-strategies')
      .send({
        name: 'No exit',
        entry: { signal: { key: 'trend', value: { type: 'string', value: 'up' } } },
        exit: {},
      });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 400,
      body: { error: 'exit must define at least one mechanism' },
    });
  });

  it('POST /backtest-strategies rejects a missing name with the validation envelope', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer()).post('/backtest-strategies').send({});
    expect({
      status: res.status,
      error: res.body.error,
      paths: res.body.fields.map((f: { path: string }) => f.path),
    }).toEqual({ status: 400, error: 'Validation failed', paths: ['name'] });
  });

  it('POST /backtest-strategies rejects an unknown property with the validation envelope', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer())
      .post('/backtest-strategies')
      .send({ ...body('X'), bogus: 1 });
    expect({
      status: res.status,
      error: res.body.error,
      paths: res.body.fields.map((f: { path: string }) => f.path),
    }).toEqual({ status: 400, error: 'Validation failed', paths: ['bogus'] });
  });

  it('POST /backtest-strategies rejects a bad threshold kind with the nested validation path', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer())
      .post('/backtest-strategies')
      .send({
        name: 'Bad kind',
        entry: { signal: { key: 'trend', value: { type: 'string', value: 'up' } } },
        exit: { profitTarget: { kind: 'bogus', amount: 5 } },
      });
    expect({
      status: res.status,
      error: res.body.error,
      paths: res.body.fields.map((f: { path: string }) => f.path),
    }).toEqual({ status: 400, error: 'Validation failed', paths: ['exit.profitTarget.kind'] });
  });
});
