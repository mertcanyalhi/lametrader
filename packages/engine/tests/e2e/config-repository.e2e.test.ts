import { Period } from '@lametrader/core';
import { ConfigService, MongoConfigRepository } from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { type Db, MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runConfigRepositoryContract } from '../../src/config/testing/config-repository.contract.js';

/**
 * E2E: the config persistence adapter against an ephemeral Mongo (Testcontainers).
 * Runs the shared {@link runConfigRepositoryContract} suite on the real adapter
 * (the same suite the in-memory fake passes in the unit tier), plus the
 * service-level guarantee that a rejected update doesn't mutate stored state.
 */
describe('config persistence (e2e)', () => {
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
  runConfigRepositoryContract(async () => {
    await db.collection('config').deleteMany({});
    return new MongoConfigRepository(db);
  });

  it('leaves the persisted value unchanged when an invalid update is rejected', async () => {
    const service = new ConfigService(new MongoConfigRepository(db));
    await service.replace({ periods: ['1h', '1d'], defaultPeriod: '1d' });

    await expect(service.patch({ periods: ['1h', '4h'] })).rejects.toThrow(
      'defaultPeriod 1d is not in periods',
    );

    expect(await new ConfigService(new MongoConfigRepository(db)).get()).toEqual({
      periods: [Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneDay,
    });
  });
});
