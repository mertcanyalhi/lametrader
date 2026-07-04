import type { ConfigRepository } from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { Model } from 'mongoose';
import { AppModule } from '../src/app.module.js';
import { CONFIG_REPOSITORY } from '../src/common/interfaces/config-repository.token.js';
import { ConfigEntry } from '../src/common/persistence/config-entry.schema.js';
import { runConfigRepositoryContract } from '../src/common/testing/config-repository.contract.js';

/**
 * Runs the shared {@link ConfigRepository} contract against the Mongoose adapter
 * over a real Mongo (Testcontainers) — the e2e half of the suite whose unit half
 * runs against the in-memory fake. Together they prove the Mongoose rewrite is
 * behaviour-identical to the old native-driver repository.
 */
describe('MongooseConfigRepository (contract, e2e)', () => {
  let container: StartedMongoDBContainer;
  let app: INestApplication;
  let repo: ConfigRepository;
  let model: Model<ConfigEntry>;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    process.env.MONGODB_URI = `${container.getConnectionString()}/?directConnection=true`;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    repo = app.get<ConfigRepository>(CONFIG_REPOSITORY);
    model = app.get<Model<ConfigEntry>>(getModelToken(ConfigEntry.name));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  // Each contract case gets a freshly-emptied `config` collection.
  runConfigRepositoryContract(async () => {
    await model.deleteMany({});
    return repo;
  });
});
