import type { BacktestRepository } from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { Model } from 'mongoose';
import { BacktestDoc } from '../src/analytics/backtesting/backtest.schema.js';
import { BACKTEST_REPOSITORY } from '../src/analytics/backtesting/backtest-repository.token.js';
import { runBacktestRepositoryContract } from '../src/analytics/backtesting/testing/backtest-repository.contract.js';
import { AppModule } from '../src/app.module.js';

/**
 * Runs the shared {@link BacktestRepository} contract against the Mongoose adapter
 * over a real Mongo (Testcontainers) — the e2e half of the suite whose unit half
 * runs against the in-memory fake. Together they prove the two behave
 * identically, including the verbatim round-trip of the embedded params /
 * strategy snapshot / trades / summary and the optional `openPosition`.
 */
describe('MongooseBacktestRepository (contract, e2e)', () => {
  let app: INestApplication;
  let repo: BacktestRepository;
  let model: Model<BacktestDoc>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    repo = app.get<BacktestRepository>(BACKTEST_REPOSITORY);
    model = app.get<Model<BacktestDoc>>(getModelToken(BacktestDoc.name));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  // Each contract case gets a freshly-emptied `backtests` collection.
  runBacktestRepositoryContract(async () => {
    await model.deleteMany({});
    return repo;
  });
});
