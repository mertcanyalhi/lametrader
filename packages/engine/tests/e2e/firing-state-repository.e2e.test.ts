import { MongoFiringStateRepository } from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { type Db, MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe } from 'vitest';
import { runFiringStateRepositoryContract } from '../../src/rules/testing/firing-state-repository.contract.js';

/**
 * E2e: the firing-state persistence adapter against an ephemeral Mongo
 * (Testcontainers), run through the same shared contract as the in-memory
 * adapter. The Mongo adapter embeds the latch on the rule document (ADR
 * 0012), so the harness seeds stub rule docs for each id the contract
 * references.
 */
describe('firing-state persistence (e2e)', () => {
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

  runFiringStateRepositoryContract(async (ruleIds) => {
    await db.collection('rules').deleteMany({});
    if (ruleIds.length > 0) {
      await db
        .collection('rules')
        .insertMany(ruleIds.map((id) => ({ _id: id as unknown as never })));
    }
    return new MongoFiringStateRepository(db);
  });
});
