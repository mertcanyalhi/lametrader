import type { ProfileRepository } from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { Model } from 'mongoose';
import { PROFILE_REPOSITORY } from '../src/analytics/interfaces/profile-repository.token.js';
import { ProfileEntry } from '../src/analytics/persistence/profile-entry.schema.js';
import { runProfileRepositoryContract } from '../src/analytics/testing/profile-repository.contract.js';
import { AppModule } from '../src/app.module.js';

/**
 * Runs the shared {@link ProfileRepository} contract against the Mongoose adapter
 * over a real Mongo (Testcontainers) — the e2e half of the suite whose unit half
 * runs against the in-memory fake. Together they prove the Mongoose rewrite is
 * behaviour-identical to the old native-driver repository.
 */
describe('MongooseProfileRepository (contract, e2e)', () => {
  let app: INestApplication;
  let repo: ProfileRepository;
  let model: Model<ProfileEntry>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    repo = app.get<ProfileRepository>(PROFILE_REPOSITORY);
    model = app.get<Model<ProfileEntry>>(getModelToken(ProfileEntry.name));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  // Each contract case gets a freshly-emptied `profiles` collection.
  runProfileRepositoryContract(async () => {
    await model.deleteMany({});
    return repo;
  });
});
