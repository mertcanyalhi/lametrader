import { MongoProfileRepository, MongoRuleRepository } from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { type Db, MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runRuleRepositoryContract } from '../../src/rules/testing/rule-repository.contract.js';

/**
 * E2e: the rule persistence adapter against an ephemeral Mongo
 * (Testcontainers), run through the shared
 * {@link runRuleRepositoryContract} suite (same suite the in-memory adapter
 * runs in the unit tier — one contract, both sides, per ADR 0001).
 */
describe('rule persistence (e2e)', () => {
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
    await db.collection('rules').deleteMany({});
    await db.collection('profiles').deleteMany({});
    const profiles = new MongoProfileRepository(db);
    const repo = new MongoRuleRepository(db, profiles);
    await repo.ensureIndexes();
    return { repo, profiles };
  });

  it('ensureIndexes creates indexes covering every listForSymbol scope branch', async () => {
    await db
      .collection('rules')
      .drop()
      .catch(() => undefined);
    const repo = new MongoRuleRepository(db, new MongoProfileRepository(db));
    await repo.ensureIndexes();
    const keys = (await db.collection('rules').listIndexes().toArray()).map((index) => index.key);
    // Every $or branch in listForSymbol must be index-supported: the
    // AllSymbols branch (scope.kind prefix), the Symbol branch
    // (scope.kind + scope.symbolId), and the Symbols branch
    // (scope.kind + scope.symbolIds, multikey).
    expect(keys).toContainEqual({ 'scope.kind': 1, 'scope.symbolId': 1 });
    expect(keys).toContainEqual({ 'scope.kind': 1, 'scope.symbolIds': 1 });
  });
});
