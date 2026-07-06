import type { BacktestStrategyRepository } from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { Model } from 'mongoose';
import { BacktestStrategyEntryDoc } from '../src/analytics/backtesting/backtest-strategy-entry.schema.js';
import { BACKTEST_STRATEGY_REPOSITORY } from '../src/analytics/backtesting/backtest-strategy-repository.token.js';
import { runBacktestStrategyRepositoryContract } from '../src/analytics/backtesting/testing/backtest-strategy-repository.contract.js';
import { AppModule } from '../src/app.module.js';

/**
 * Runs the shared {@link BacktestStrategyRepository} contract against the Mongoose
 * adapter over a real Mongo (Testcontainers) — the e2e half of the suite whose
 * unit half runs against the in-memory fake. Together they prove the two behave
 * identically, including the verbatim round-trip of the embedded tagged
 * `entry` / `exit` unions.
 */
describe('MongooseBacktestStrategyRepository (contract, e2e)', () => {
  let app: INestApplication;
  let repo: BacktestStrategyRepository;
  let model: Model<BacktestStrategyEntryDoc>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    repo = app.get<BacktestStrategyRepository>(BACKTEST_STRATEGY_REPOSITORY);
    model = app.get<Model<BacktestStrategyEntryDoc>>(getModelToken(BacktestStrategyEntryDoc.name));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  // Each contract case gets a freshly-emptied `backtest_strategies` collection.
  runBacktestStrategyRepositoryContract(async () => {
    await model.deleteMany({});
    return repo;
  });
});
