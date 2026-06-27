import { type RuleEventEntry, RuleEventType } from '@lametrader/core';
import { MongoEventLog } from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { type Db, MongoClient } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * E2e for {@link MongoEventLog} (#290) — the Mongo-backed
 * {@link EventLog} adapter that mirrors fired rule events onto the parent
 * rule's `rules.{ruleId}.events` array AND the affected symbol's
 * `watchlist.{symbolId}.events` array (per ADR 0012).
 *
 * Drives the contract directly against a Testcontainers Mongo so the
 * production code path (`$push` writes + array reads) is exercised end-to-end.
 */
describe('MongoEventLog (e2e)', () => {
  let container: StartedMongoDBContainer;
  let client: MongoClient;
  let db: Db;
  let log: MongoEventLog;

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

  beforeEach(async () => {
    await db.collection('watchlist').deleteMany({});
    await db.collection('rules').deleteMany({});
    await db.collection('watchlist').insertOne({ _id: 'AAPL' });
    await db.collection('rules').insertOne({ _id: 'rule-1' });
    log = new MongoEventLog(db);
  });

  it('appendSymbolEvent pushes the entry onto the symbol document events array', async () => {
    const entry: RuleEventEntry = {
      type: RuleEventType.Fired,
      ts: 1000,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
    };
    await log.appendSymbolEvent('AAPL', entry);
    expect(await log.symbolEvents('AAPL')).toEqual([entry]);
  });

  it('appendRuleEvent pushes the entry onto the rule document events array', async () => {
    const entry: RuleEventEntry = {
      type: RuleEventType.Fired,
      ts: 1000,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
    };
    await log.appendRuleEvent('rule-1', entry);
    expect(await log.ruleEvents('rule-1')).toEqual([entry]);
  });

  it('symbolEvents returns the events in append order across multiple writes', async () => {
    const first: RuleEventEntry = {
      type: RuleEventType.Fired,
      ts: 1000,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
    };
    const second: RuleEventEntry = {
      type: RuleEventType.Error,
      ts: 2000,
      ruleId: '',
      symbolId: 'AAPL',
      reason: 'rule orchestration failed: boom',
    };
    await log.appendSymbolEvent('AAPL', first);
    await log.appendSymbolEvent('AAPL', second);
    expect(await log.symbolEvents('AAPL')).toEqual([first, second]);
  });

  it('symbolEvents returns an empty array for a symbol with no events field', async () => {
    await db.collection('watchlist').insertOne({ _id: 'MSFT' });
    expect(await log.symbolEvents('MSFT')).toEqual([]);
  });

  it('ruleEvents returns an empty array for a rule with no events field', async () => {
    await db.collection('rules').insertOne({ _id: 'rule-empty' });
    expect(await log.ruleEvents('rule-empty')).toEqual([]);
  });
});
