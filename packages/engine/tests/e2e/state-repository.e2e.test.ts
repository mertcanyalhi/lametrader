import { type StateValue, StateValueType } from '@lametrader/core';
import { MongoStateRepository } from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { type Db, MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runStateRepositoryContract } from '../../src/state/testing/state-repository.contract.js';

/**
 * E2E: the state persistence adapter against an ephemeral Mongo
 * (Testcontainers), run through the same {@link runStateRepositoryContract}
 * suite as the in-memory adapter, plus an adapter-specific suite covering
 * per-`StateValueType` round-trips and the unique index spec.
 */
describe('state persistence (e2e)', () => {
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

  // Shared contract — every `make` returns a fresh, empty store.
  runStateRepositoryContract(async () => {
    await db.collection('state').deleteMany({});
    const repo = new MongoStateRepository(db);
    await repo.ensureIndexes();
    return repo;
  });

  describe('per-StateValueType round-trip', () => {
    const cases: { name: string; value: StateValue }[] = [
      { name: 'String', value: { type: StateValueType.String, value: 'hello' } },
      { name: 'Number', value: { type: StateValueType.Number, value: 42 } },
      { name: 'Bool', value: { type: StateValueType.Bool, value: true } },
      { name: 'Enum', value: { type: StateValueType.Enum, value: 'risk-on' } },
    ];

    for (const { name, value } of cases) {
      it(`round-trips the ${name} variant unchanged`, async () => {
        await db.collection('state').deleteMany({});
        const repo = new MongoStateRepository(db);
        await repo.ensureIndexes();
        await repo.setSymbolState('AAPL', 'k', value, 100);
        expect(await repo.getSymbolState('AAPL', 'k')).toEqual(value);
      });
    }
  });

  describe('indexes', () => {
    it('creates a unique index on (scope, symbolId, key) named scope_symbolId_key_unique', async () => {
      await db.collection('state').deleteMany({});
      const repo = new MongoStateRepository(db);
      await repo.ensureIndexes();
      const indexes = await db.collection('state').indexes();
      const target = indexes.find((index) => index.name === 'scope_symbolId_key_unique');
      expect(target).toEqual({
        v: expect.any(Number),
        key: { scope: 1, symbolId: 1, key: 1 },
        name: 'scope_symbolId_key_unique',
        unique: true,
      });
    });
  });
});
