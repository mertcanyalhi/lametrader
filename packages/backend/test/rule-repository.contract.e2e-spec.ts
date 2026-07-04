import type { ProfileRepository } from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { Model } from 'mongoose';
import { PROFILE_REPOSITORY } from '../src/analytics/interfaces/profile-repository.token.js';
import { ProfileEntry } from '../src/analytics/persistence/profile-entry.schema.js';
import { MongooseRuleRepository } from '../src/analytics/rules/mongoose-rule.repository.js';
import { RuleEntry } from '../src/analytics/rules/rule-entry.schema.js';
import { runRuleRepositoryContract } from '../src/analytics/rules/testing/rule-repository.contract.js';
import { AppModule } from '../src/app.module.js';

/**
 * Runs the shared {@link import('@lametrader/core').RuleRepository} contract against the Mongoose adapter
 * over a real Mongo (Testcontainers) — the e2e half of the suite whose unit half
 * runs against the in-memory fake. Together they prove the Mongoose rewrite is
 * behaviour-identical to the old native-driver `MongoRuleRepository`, including
 * the greenfield v2 rule-shape round-trip (ADR-0016) and the `profile.enabled`
 * kill-switch `listEnabledForSymbol` consults (ADR-0012 #5).
 *
 * The adapter is constructed directly over the app's registered rule model and
 * the app's shared {@link ProfileRepository}, so the profile-enabled filter reads
 * the same store the contract seeds through `PROFILE_REPOSITORY`.
 */
describe('MongooseRuleRepository (contract, e2e)', () => {
  let container: StartedMongoDBContainer;
  let app: INestApplication;
  let model: Model<RuleEntry>;
  let profileModel: Model<ProfileEntry>;
  let profiles: ProfileRepository;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    process.env.MONGODB_URI = `${container.getConnectionString()}/?directConnection=true`;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    model = app.get<Model<RuleEntry>>(getModelToken(RuleEntry.name));
    profileModel = app.get<Model<ProfileEntry>>(getModelToken(ProfileEntry.name));
    profiles = app.get<ProfileRepository>(PROFILE_REPOSITORY);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  // Each contract case gets freshly-emptied `rules` + `profiles` collections.
  runRuleRepositoryContract(async () => {
    await model.deleteMany({});
    await profileModel.deleteMany({});
    return { repo: new MongooseRuleRepository(model, profiles), profiles };
  });
});
