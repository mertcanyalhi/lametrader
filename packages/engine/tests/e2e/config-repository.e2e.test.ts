import { Period } from '@lametrader/core';
import { ConfigService, MongoConfigRepository } from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { type Db, MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * E2E: the config persistence adapter against an ephemeral Mongo (Testcontainers).
 * Validates that config durably round-trips and that rejected updates don't
 * mutate stored state.
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

  it('round-trips a config through a fresh repository instance', async () => {
    const config = {
      periods: [Period.OneHour, Period.FourHours, Period.OneDay],
      defaultPeriod: Period.FourHours,
    };
    await new MongoConfigRepository(db).save(config);

    expect(await new MongoConfigRepository(db).load()).toEqual(config);
  });

  it('leaves the persisted value unchanged when an invalid update is rejected', async () => {
    const service = new ConfigService(new MongoConfigRepository(db));
    await service.replace({ periods: ['1h', '1d'], defaultPeriod: '1d' });

    await expect(service.patch({ periods: ['1h', '4h'] })).rejects.toThrow(
      'defaultPeriod 1d is not in periods',
    );

    expect(await new MongoConfigRepository(db).load()).toEqual({
      periods: [Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneDay,
    });
  });
});
