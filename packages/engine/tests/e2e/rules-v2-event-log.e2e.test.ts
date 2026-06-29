import { RulesV2 } from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { type Db, MongoClient } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe } from 'vitest';

import {
  FIXED_FIRED_AT,
  runEventLogContract,
} from '../../src/rules-v2/testing/event-log.contract.js';

/**
 * E2e: the v2 event log adapter against an ephemeral Mongo (Testcontainers),
 * run through the shared {@link runEventLogContract} suite (same suite the
 * in-memory adapter runs in the unit tier).
 *
 * The Mongo adapter writes rule events to `rules_v2.{ruleId}.events` and
 * symbol events to `watchlist.{symbolId}.events_v2` — both append-on-upsert
 * so the contract's "unknown id returns []" tests pass without pre-seeding
 * documents.
 */
describe('rules-v2 event log (e2e)', () => {
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

  afterEach(async () => {
    await db.collection('rules_v2').deleteMany({});
    await db.collection('watchlist').deleteMany({});
  });

  runEventLogContract(async () => {
    await db.collection('rules_v2').deleteMany({});
    await db.collection('watchlist').deleteMany({});
    const log = new RulesV2.MongoEventLog(db, () => FIXED_FIRED_AT);
    return { log };
  });
});
