import type { WatchlistRepository } from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { Model } from 'mongoose';
import { AppModule } from '../src/app.module.js';
import { WATCHLIST_REPOSITORY } from '../src/market/interfaces/watchlist-repository.token.js';
import { WatchlistEntry } from '../src/market/persistence/watchlist-entry.schema.js';
import { runWatchlistRepositoryContract } from '../src/market/testing/watchlist-repository.contract.js';

/**
 * Runs the shared {@link WatchlistRepository} contract against the Mongoose
 * adapter over a real Mongo (Testcontainers) — the e2e half of the suite whose
 * unit half runs against the in-memory fake. Together they prove the Mongoose
 * rewrite is behaviour-identical to the old native-driver repository.
 */
describe('MongooseWatchlistRepository (contract, e2e)', () => {
  let app: INestApplication;
  let repo: WatchlistRepository;
  let model: Model<WatchlistEntry>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    repo = app.get<WatchlistRepository>(WATCHLIST_REPOSITORY);
    model = app.get<Model<WatchlistEntry>>(getModelToken(WatchlistEntry.name));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  // Each contract case gets a freshly-emptied `watchlist` collection.
  runWatchlistRepositoryContract(async () => {
    await model.deleteMany({});
    return repo;
  });
});
