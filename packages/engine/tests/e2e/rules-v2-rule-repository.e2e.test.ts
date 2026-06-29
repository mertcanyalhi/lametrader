import { MongoProfileRepository, RulesV2 } from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { type Db, MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe } from 'vitest';

import { runRuleRepositoryContract } from '../../src/rules-v2/testing/rule-repository.contract.js';

/**
 * E2e: the v2 rule persistence adapter against an ephemeral Mongo
 * (Testcontainers), run through the shared
 * {@link runRuleRepositoryContract} suite (same suite the in-memory adapter
 * runs in the unit tier — one contract, both sides, per ADR 0001).
 */
describe('rules-v2 rule persistence (e2e)', () => {
  let container: StartedMongoDBContainer;
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    client = new MongoClient(container.getConnectionString(), { directConnection: true });
    await client.connect();
    db = client.db('lametrader');
  });

  afterAll(async () => {
    await client?.close();
    await container?.stop();
  });

  runRuleRepositoryContract(async () => {
    await db.collection('rules_v2').deleteMany({});
    await db.collection('profiles').deleteMany({});
    const profiles = new MongoProfileRepository(db);
    const repo = new RulesV2.MongoRuleRepository(db, profiles);
    await repo.ensureIndexes();
    return { repo, profiles };
  });
});
