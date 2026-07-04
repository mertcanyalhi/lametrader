import type { CandleRepository } from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { Model } from 'mongoose';
import { AppModule } from '../src/app.module.js';
import { CANDLE_REPOSITORY } from '../src/market/interfaces/candle-repository.token.js';
import { CandleEntry } from '../src/market/persistence/candle-entry.schema.js';
import { runCandleRepositoryContract } from '../src/market/testing/candle-repository.contract.js';

/**
 * Runs the shared {@link CandleRepository} contract against the Mongoose adapter
 * over a real Mongo (Testcontainers) — the e2e half of the suite whose unit half
 * runs against the in-memory fake. Together they prove the Mongoose rewrite is
 * behaviour-identical to the old native-driver `MongoCandleRepository`, including
 * the compound `(symbol, period, time)` `_id` upsert semantics and the
 * discriminated crypto / equity / FX candle round-trip.
 */
describe('MongooseCandleRepository (contract, e2e)', () => {
  let container: StartedMongoDBContainer;
  let app: INestApplication;
  let repo: CandleRepository;
  let model: Model<CandleEntry>;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    process.env.MONGODB_URI = `${container.getConnectionString()}/?directConnection=true`;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    repo = app.get<CandleRepository>(CANDLE_REPOSITORY);
    model = app.get<Model<CandleEntry>>(getModelToken(CandleEntry.name));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  // Each contract case gets a freshly-emptied `candles` collection.
  runCandleRepositoryContract(async () => {
    await model.deleteMany({});
    return repo;
  });
});
