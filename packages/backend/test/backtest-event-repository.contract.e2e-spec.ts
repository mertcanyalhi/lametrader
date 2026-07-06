import type { BacktestEventRepository } from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { Model } from 'mongoose';
import { BacktestEventDoc } from '../src/analytics/backtesting/backtest-event.schema.js';
import { BACKTEST_EVENT_REPOSITORY } from '../src/analytics/backtesting/backtest-event-repository.token.js';
import { runBacktestEventRepositoryContract } from '../src/analytics/backtesting/testing/backtest-event-repository.contract.js';
import { AppModule } from '../src/app.module.js';

/**
 * Runs the shared {@link BacktestEventRepository} contract against the Mongoose
 * adapter over a real Mongo (Testcontainers) — the e2e half of the suite whose
 * unit half runs against the in-memory fake. Together they prove the two behave
 * identically: append preserves emission order, `window` reads newest-first
 * within the bounds and honours `limit`, and events are keyed per `backtestId`
 * with a cascade delete.
 */
describe('MongooseBacktestEventRepository (contract, e2e)', () => {
  let app: INestApplication;
  let repo: BacktestEventRepository;
  let model: Model<BacktestEventDoc>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    repo = app.get<BacktestEventRepository>(BACKTEST_EVENT_REPOSITORY);
    model = app.get<Model<BacktestEventDoc>>(getModelToken(BacktestEventDoc.name));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  // Each contract case gets a freshly-emptied `backtest_events` collection.
  runBacktestEventRepositoryContract(async () => {
    await model.deleteMany({});
    return repo;
  });
});
