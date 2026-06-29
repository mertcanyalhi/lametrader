import {
  type Action,
  ActionKind,
  ConditionNodeKind,
  NumericOperator,
  OperandKind,
  type Rule,
  RuleEventType,
  RuleScopeKind,
  RulesV2,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';
import { RulesV2 as EngineRulesV2, MongoEventLog, MongoRuleRepository } from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { type Db, MongoClient } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * E2e proving v1's `rules` collection + `watchlist.events` field are
 * untouched when v2 writes rules to `rules_v2` and events to
 * `rules_v2.{ruleId}.events` / `watchlist.{symbolId}.events_v2`.
 *
 * One Mongo instance, both adapters, side-by-side.
 */
describe('rules-v2 / rules-v1 Mongo coexistence (e2e)', () => {
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

  beforeEach(async () => {
    await db.collection('rules').deleteMany({});
    await db.collection('rules_v2').deleteMany({});
    await db.collection('watchlist').deleteMany({});
  });

  it('writing a v2 rule to rules_v2 leaves the v1 rules collection empty', async () => {
    const v2Repo = new EngineRulesV2.MongoRuleRepository(db);
    const v2Rule: RulesV2.Rule = {
      id: 'r-v2',
      profileId: 'p1',
      name: 'v2 rule',
      scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
        kind: RulesV2.ConditionNodeKind.Leaf,
        leaf: {
          family: RulesV2.LeafConditionFamily.Comparison,
          operator: RulesV2.ComparisonOperator.Gt,
          left: { kind: RulesV2.OperandKind.Price },
          right: {
            kind: RulesV2.OperandKind.Literal,
            value: { type: StateValueType.Number, value: 100 },
          },
        },
      },
      trigger: { kind: RulesV2.TriggerKind.EveryTime },
      expiration: null,
      actions: [
        {
          kind: RulesV2.ActionKind.Notification,
          channel: RulesV2.NotificationChannel.Telegram,
          destinationName: 'main',
          template: 'fired',
        },
      ],
      enabled: true,
      order: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    await v2Repo.save(v2Rule);
    expect(await db.collection('rules').countDocuments()).toBe(0);
    expect(await db.collection('rules_v2').countDocuments()).toBe(1);
  });

  it('writing a v1 rule to rules leaves the v2 rules_v2 collection empty', async () => {
    const v1Repo = new MongoRuleRepository(db);
    const v1Actions: Action[] = [
      { kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'fired' },
    ];
    const v1Rule: Rule = {
      id: 'r-v1',
      profileId: 'p1',
      name: 'v1 rule',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
        kind: ConditionNodeKind.Leaf,
        left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
        operator: NumericOperator.Gt,
        right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 100 } },
      },
      trigger: { kind: TriggerKind.EveryTime },
      expiration: null,
      actions: v1Actions,
      enabled: true,
      events: [],
      history: [],
      createdAt: 0,
      updatedAt: 0,
    };
    await v1Repo.save(v1Rule);
    expect(await db.collection('rules_v2').countDocuments()).toBe(0);
    expect(await db.collection('rules').countDocuments()).toBe(1);
  });

  it('writes a v2 symbol event to watchlist.events_v2 without touching watchlist.events', async () => {
    const v1Log = new MongoEventLog(db, () => 1);
    const v2Log = new EngineRulesV2.MongoEventLog(db, () => 2);
    await db.collection('watchlist').insertOne({ _id: 'AAPL' as unknown as undefined });
    // v1 writes onto watchlist.events
    await v1Log.appendSymbolEvent('AAPL', {
      type: RuleEventType.Fired,
      ts: 1,
      ruleId: 'r-v1',
      symbolId: 'AAPL',
    });
    // v2 writes onto watchlist.events_v2
    await v2Log.appendSymbolEvent('AAPL', {
      type: RulesV2.RuleEventType.Fired,
      ts: 2,
      ruleId: 'r-v2',
      symbolId: 'AAPL',
      context: {
        inboundEvent: {
          kind: RulesV2.EvaluationTriggerKind.Tick,
          symbolId: 'AAPL',
          ts: 2,
          price: 101,
        },
        lookupSnapshot: {
          current: 101,
          open: null,
          high: null,
          low: null,
          close: null,
          volume: null,
        },
      },
    });
    const doc = await db.collection('watchlist').findOne({ _id: 'AAPL' as unknown as undefined });
    expect(Array.isArray(doc?.events)).toBe(true);
    expect(doc?.events).toHaveLength(1);
    expect(doc?.events?.[0]?.type).toBe(RuleEventType.Fired);
    expect(Array.isArray(doc?.events_v2)).toBe(true);
    expect(doc?.events_v2).toHaveLength(1);
    expect(doc?.events_v2?.[0]?.type).toBe(RulesV2.RuleEventType.Fired);
  });
});
