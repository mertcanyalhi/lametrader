import type { StateRepository } from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { Model } from 'mongoose';
import { AppModule } from '../src/app.module.js';
import { StateEntry } from '../src/state/state-entry.schema.js';
import { STATE_REPOSITORY } from '../src/state/state-repository.token.js';
import { runStateRepositoryContract } from '../src/state/testing/state-repository.contract.js';

/**
 * Runs the shared {@link StateRepository} contract against the Mongoose adapter
 * over a real Mongo (Testcontainers) — the e2e half of the suite whose unit half
 * runs against the in-memory fake. Together they prove the Mongoose rewrite is
 * behaviour-identical to the old native-driver `MongoStateRepository`, including
 * the per-`profileId` partitioning (ADR-0014) and the tagged-union
 * {@link import('@lametrader/core').StateValue} round-trip (ADR-0013).
 */
describe('MongooseStateRepository (contract, e2e)', () => {
  let container: StartedMongoDBContainer;
  let app: INestApplication;
  let repo: StateRepository;
  let model: Model<StateEntry>;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    process.env.MONGODB_URI = `${container.getConnectionString()}/?directConnection=true`;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    repo = app.get<StateRepository>(STATE_REPOSITORY);
    model = app.get<Model<StateEntry>>(getModelToken(StateEntry.name));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  // Each contract case gets a freshly-emptied `state` collection.
  runStateRepositoryContract(async () => {
    await model.deleteMany({});
    return repo;
  });
});
