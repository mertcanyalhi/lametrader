import { RulesV2 } from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { type Db, MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe } from 'vitest';

import { runEventLogContract } from '../../src/rules-v2/testing/event-log.contract.js';

/**
 * E2e: the v2 {@link RulesV2.MongoEventLog} against an ephemeral Mongo
 * (Testcontainers), run through the shared event-log contract suite.
 *
 * The contract appends entries under fixed ids `r1` (rule) and `BTC`
 * (symbol); the factory pre-creates empty parent docs so the v2 `$push` on
 * `rules_v2.{r1}.events` and `watchlist.{BTC}.events_v2` lands (`$push`
 * against a missing doc is a no-op).
 */
describe('rules-v2: MongoEventLog (e2e)', () => {
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

  runEventLogContract(async (firedAtClock) => {
    await db.collection('rules_v2').deleteMany({});
    await db.collection('watchlist').deleteMany({});
    await db.collection('rules_v2').insertOne({ _id: 'r1' });
    await db.collection('watchlist').insertOne({ _id: 'BTC' });
    return new RulesV2.MongoEventLog(db, () => firedAtClock);
  });
});
