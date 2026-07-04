import type { ProfileRepository } from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { Model } from 'mongoose';
import { AppModule } from '../src/app.module.js';
import { ProfileEntry } from '../src/profiles/profile-entry.schema.js';
import { PROFILE_REPOSITORY } from '../src/profiles/profile-repository.token.js';
import { runProfileRepositoryContract } from '../src/profiles/testing/profile-repository.contract.js';

/**
 * Runs the shared {@link ProfileRepository} contract against the Mongoose adapter
 * over a real Mongo (Testcontainers) — the e2e half of the suite whose unit half
 * runs against the in-memory fake. Together they prove the Mongoose rewrite is
 * behaviour-identical to the old native-driver repository.
 */
describe('MongooseProfileRepository (contract, e2e)', () => {
  let container: StartedMongoDBContainer;
  let app: INestApplication;
  let repo: ProfileRepository;
  let model: Model<ProfileEntry>;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    process.env.MONGODB_URI = `${container.getConnectionString()}/?directConnection=true`;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    repo = app.get<ProfileRepository>(PROFILE_REPOSITORY);
    model = app.get<Model<ProfileEntry>>(getModelToken(ProfileEntry.name));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  // Each contract case gets a freshly-emptied `profiles` collection.
  runProfileRepositoryContract(async () => {
    await model.deleteMany({});
    return repo;
  });
});
