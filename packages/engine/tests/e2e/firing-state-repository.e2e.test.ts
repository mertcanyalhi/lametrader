import { MongoFiringStateRepository } from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { type Db, MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe } from 'vitest';
import { runFiringStateRepositoryContract } from '../../src/rules/testing/firing-state-repository.contract.js';

/**
 * E2e: the firing-state persistence adapter against an ephemeral Mongo
 * (Testcontainers), run through the same shared contract as the in-memory
 * adapter.
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

  runFiringStateRepositoryContract(async () => {
    await db.collection('firing_state').deleteMany({});
    return new MongoFiringStateRepository(db);
  });
});
