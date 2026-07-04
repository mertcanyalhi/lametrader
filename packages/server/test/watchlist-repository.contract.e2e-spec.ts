import type { WatchlistRepository } from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { Model } from 'mongoose';
import { AppModule } from '../src/app.module.js';
import { runWatchlistRepositoryContract } from '../src/watchlist/testing/watchlist-repository.contract.js';
import { WatchlistEntry } from '../src/watchlist/watchlist-entry.schema.js';
import { WATCHLIST_REPOSITORY } from '../src/watchlist/watchlist-repository.token.js';

/**
 * Runs the shared {@link WatchlistRepository} contract against the Mongoose
 * adapter over a real Mongo (Testcontainers) — the e2e half of the suite whose
 * unit half runs against the in-memory fake. Together they prove the Mongoose
 * rewrite is behaviour-identical to the old native-driver repository.
 */
describe('MongooseWatchlistRepository (contract, e2e)', () => {
  let container: StartedMongoDBContainer;
  let app: INestApplication;
  let repo: WatchlistRepository;
  let model: Model<WatchlistEntry>;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    process.env.MONGODB_URI = `${container.getConnectionString()}/?directConnection=true`;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    repo = app.get<WatchlistRepository>(WATCHLIST_REPOSITORY);
    model = app.get<Model<WatchlistEntry>>(getModelToken(WatchlistEntry.name));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  // Each contract case gets a freshly-emptied `watchlist` collection.
  runWatchlistRepositoryContract(async () => {
    await model.deleteMany({});
    return repo;
  });
});
