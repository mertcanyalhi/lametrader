import { MongoCandleRepository } from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { type Db, MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe } from 'vitest';
import { runCandleRepositoryContract } from '../../src/candles/testing/candle-repository.contract.js';

/**
 * E2E: the candle persistence adapter against an ephemeral Mongo (Testcontainers),
 * run through the shared {@link runCandleRepositoryContract} suite. This verifies
 * on the real adapter what the in-memory tier verifies on the fake — ascending
 * range reads, idempotent upsert by `(symbol, period, time)`, and `latest()`.
 */
describe('candle persistence (e2e)', () => {
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
  runCandleRepositoryContract(async () => {
    await db.collection('candles').deleteMany({});
    return new MongoCandleRepository(db);
  });
});
