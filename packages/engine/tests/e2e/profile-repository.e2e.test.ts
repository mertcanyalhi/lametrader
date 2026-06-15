import { MongoProfileRepository } from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { type Db, MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe } from 'vitest';
import { runProfileRepositoryContract } from '../../src/profiles/testing/profile-repository.contract.js';

/**
 * E2E: the profile persistence adapter against an ephemeral Mongo (Testcontainers),
 * run through the shared {@link runProfileRepositoryContract} suite. This verifies
 * on the real adapter what the in-memory tier verifies on the fake — save/get
 * round-trip, list, replace-by-id, null-on-miss, and idempotent remove.
 */
describe('profile persistence (e2e)', () => {
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

  // The contract expects a fresh, empty store per case — clear the collection.
  runProfileRepositoryContract(async () => {
    await db.collection('profiles').deleteMany({});
    return new MongoProfileRepository(db);
  });
});
