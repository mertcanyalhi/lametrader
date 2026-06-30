import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { type Db, MongoClient } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { migrateRulesV2ToRules } from '../../src/scripts/migrate-rules-v2-to-rules.js';

/**
 * E2e: the one-shot operator-controlled migration that renames the legacy
 * `rules_v2` collection to `rules` and the watchlist field `events_v2` to
 * `events` (issue #437).
 */
describe('migrateRulesV2ToRules (e2e)', () => {
  let container: StartedMongoDBContainer;
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    client = new MongoClient(container.getConnectionString(), { directConnection: true });
    await client.connect();
    db = client.db('lametrader-migration-e2e');
  });

  afterAll(async () => {
    await client?.close();
    await container?.stop();
  });

  afterEach(async () => {
    for (const entry of await db.listCollections({}, { nameOnly: true }).toArray()) {
      await db.collection(entry.name).drop();
    }
  });

  it('renames the rules_v2 collection to rules and the watchlist events_v2 field to events', async () => {
    const ruleDocs = [
      { _id: 'rule-a', name: 'a', order: 0 },
      { _id: 'rule-b', name: 'b', order: 1 },
    ];
    const events = [
      { type: 'Fired', ts: 1, ruleId: 'rule-a' },
      { type: 'Fired', ts: 2, ruleId: 'rule-a' },
    ];
    await db
      .collection('rules_v2')
      .insertMany(ruleDocs.map((doc) => ({ ...doc }) as unknown as { _id: string }));
    await db.collection('watchlist').insertOne({
      _id: 'AAPL' as unknown as string,
      type: 'stock',
      description: 'Apple',
      exchange: 'NASDAQ',
      periods: ['1m'],
      events_v2: events,
    });

    await migrateRulesV2ToRules(db);

    const collectionNames = new Set(
      (await db.listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name),
    );
    const movedRules = await db
      .collection('rules')
      .find({}, { sort: { order: 1 } })
      .toArray();
    const watchlistDoc = await db
      .collection<{ _id: string; events?: unknown[]; events_v2?: unknown[] }>('watchlist')
      .findOne({ _id: 'AAPL' });
    expect({
      hasLegacyCollection: collectionNames.has('rules_v2'),
      hasNewCollection: collectionNames.has('rules'),
      movedRules,
      watchlistEvents: watchlistDoc?.events,
      watchlistHasLegacyField: watchlistDoc !== null && 'events_v2' in watchlistDoc,
    }).toEqual({
      hasLegacyCollection: false,
      hasNewCollection: true,
      movedRules: ruleDocs,
      watchlistEvents: events,
      watchlistHasLegacyField: false,
    });
  });

  it('is idempotent on a second invocation against an already-migrated dataset', async () => {
    await db.collection('rules_v2').insertOne({ _id: 'rule-a' as unknown as string, name: 'a' });
    await db
      .collection('watchlist')
      .insertOne({ _id: 'AAPL' as unknown as string, events_v2: [{ type: 'Fired', ts: 1 }] });
    await migrateRulesV2ToRules(db);

    await migrateRulesV2ToRules(db);

    const collectionNames = new Set(
      (await db.listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name),
    );
    const rules = await db.collection('rules').find({}).toArray();
    const watchlistDoc = await db
      .collection<{ _id: string; events?: unknown[]; events_v2?: unknown[] }>('watchlist')
      .findOne({ _id: 'AAPL' });
    expect({
      hasLegacyCollection: collectionNames.has('rules_v2'),
      hasNewCollection: collectionNames.has('rules'),
      rules,
      watchlistEvents: watchlistDoc?.events,
      watchlistHasLegacyField: watchlistDoc !== null && 'events_v2' in watchlistDoc,
    }).toEqual({
      hasLegacyCollection: false,
      hasNewCollection: true,
      rules: [{ _id: 'rule-a', name: 'a' }],
      watchlistEvents: [{ type: 'Fired', ts: 1 }],
      watchlistHasLegacyField: false,
    });
  });

  it('throws when both rules_v2 and rules collections exist', async () => {
    await db.collection('rules_v2').insertOne({ _id: 'rule-a' as unknown as string });
    await db.collection('rules').insertOne({ _id: 'rule-b' as unknown as string });

    const error = await migrateRulesV2ToRules(db).catch((err: unknown) => err);

    const collectionNames = new Set(
      (await db.listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name),
    );
    expect({
      isError: error instanceof Error,
      message: error instanceof Error ? error.message : undefined,
      hasLegacy: collectionNames.has('rules_v2'),
      hasNew: collectionNames.has('rules'),
    }).toEqual({
      isError: true,
      message:
        'Both `rules_v2` and `rules` collections exist; refusing to overwrite. Reconcile manually before re-running the migration.',
      hasLegacy: true,
      hasNew: true,
    });
  });
});
