import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { Model } from 'mongoose';
import request from 'supertest';
import { BacktestStrategyEntryDoc } from '../src/analytics/backtesting/backtest-strategy-entry.schema.js';
import { AppModule } from '../src/app.module.js';

/**
 * E2E for the backtest-strategies feature from the API consumer's perspective:
 * the real Nest app over a real Mongo (Testcontainers). Exercises the strategy
 * CRUD lifecycle over HTTP and one critical failure mode (duplicate name).
 */
describe('backtest-strategies API (e2e)', () => {
  let app: INestApplication;
  let strategyModel: Model<BacktestStrategyEntryDoc>;

  /** A valid create body keyed to a `trend` state change. */
  const body = (name: string) => ({
    name,
    entry: { signal: { key: 'trend', value: { type: 'string', value: 'up' } } },
    exit: {
      signal: { key: 'trend', value: { type: 'string', value: 'down' } },
      profitTarget: { kind: 'percentage', amount: 5 },
    },
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    strategyModel = app.get<Model<BacktestStrategyEntryDoc>>(
      getModelToken(BacktestStrategyEntryDoc.name),
    );
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await strategyModel.deleteMany({});
  });

  it('traces create → get → put → delete over HTTP', async () => {
    const server = app.getHttpServer();
    const created = await request(server).post('/backtest-strategies').send(body('Breakout'));
    const id = created.body.id;
    const got = await request(server).get(`/backtest-strategies/${id}`);
    const replaced = await request(server)
      .put(`/backtest-strategies/${id}`)
      .send({
        name: 'Swing',
        entry: { signal: { key: 'regime', value: { type: 'string', value: 'bull' } } },
        exit: { stopLoss: { kind: 'fixed', amount: 3 } },
      });
    const deleted = await request(server).delete(`/backtest-strategies/${id}`);
    const afterDelete = await request(server).get('/backtest-strategies');

    expect({
      createStatus: created.status,
      createName: created.body.name,
      createExit: created.body.exit,
      getStatus: got.status,
      getName: got.body.name,
      replaceStatus: replaced.status,
      replaceName: replaced.body.name,
      replaceExit: replaced.body.exit,
      deleteStatus: deleted.status,
      afterDeleteBody: afterDelete.body,
    }).toEqual({
      createStatus: 201,
      createName: 'Breakout',
      createExit: {
        signal: { key: 'trend', value: { type: 'string', value: 'down' } },
        profitTarget: { kind: 'percentage', amount: 5 },
      },
      getStatus: 200,
      getName: 'Breakout',
      replaceStatus: 200,
      replaceName: 'Swing',
      replaceExit: { stopLoss: { kind: 'fixed', amount: 3 } },
      deleteStatus: 204,
      afterDeleteBody: [],
    });
  });

  it('rejects creating a second strategy with a duplicate name with 409', async () => {
    const server = app.getHttpServer();
    await request(server).post('/backtest-strategies').send(body('Breakout'));
    const again = await request(server).post('/backtest-strategies').send(body('Breakout'));
    const listed = await request(server).get('/backtest-strategies');
    expect({ status: again.status, count: listed.body.length }).toEqual({ status: 409, count: 1 });
  });

  it('rejects a strategy without any exit mechanism with 400', async () => {
    const server = app.getHttpServer();
    const res = await request(server)
      .post('/backtest-strategies')
      .send({
        name: 'No exit',
        entry: { signal: { key: 'trend', value: { type: 'string', value: 'up' } } },
        exit: {},
      });
    expect({ status: res.status, error: res.body.error }).toEqual({
      status: 400,
      error: 'exit must define at least one mechanism',
    });
  });
});
