import {
  ActionKind,
  ConditionNodeKind,
  NumericOperator,
  OperandKind,
  type Rule,
  RuleScopeKind,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';
import {
  defaultIndicators,
  InMemoryWatchlistRepository,
  MongoFiringStateRepository,
  MongoProfileRepository,
  MongoRuleRepository,
  ProfileService,
} from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { type Db, MongoClient } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * E2E: deleting a profile through `ProfileService` against real Mongo also
 * removes every rule belonging to that profile. The deleted rules' embedded
 * `firingState` maps die with the rule documents — no separate firing-state
 * cascade (ADR 0014).
 */
describe('profile delete cascade (e2e)', () => {
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
    await db.collection('profiles').deleteMany({});
    await db.collection('rules').deleteMany({});
  });

  it('leaves no orphan rule documents or firing-state entries for the deleted profile', async () => {
    const profiles = new MongoProfileRepository(db);
    const rules = new MongoRuleRepository(db);
    const firingState = new MongoFiringStateRepository(db);
    let counter = 0;
    const service = new ProfileService(
      profiles,
      new InMemoryWatchlistRepository(),
      defaultIndicators(),
      {
        newId: () => `p${++counter}`,
        now: () => 1000,
        rules,
      },
    );

    const doomed = await service.create({ name: 'Doomed' });
    const survivor = await service.create({ name: 'Survivor' });
    const baseRule: Omit<Rule, 'id' | 'profileId'> = {
      name: 'r',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
        kind: ConditionNodeKind.Leaf,
        left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
        operator: NumericOperator.Gt,
        right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
      },
      trigger: { kind: TriggerKind.Once },
      expiration: null,
      actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'hi' }],
      enabled: true,
      events: [],
      history: [],
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    };
    await rules.save({ ...baseRule, id: 'doomed-rule', profileId: doomed.id });
    await rules.save({ ...baseRule, id: 'survivor-rule', profileId: survivor.id });
    await firingState.setActive('doomed-rule', 'AAPL', true);
    await firingState.setActive('survivor-rule', 'AAPL', true);

    await service.remove(doomed.id);

    expect(await db.collection('rules').find({ profileId: doomed.id }).toArray()).toEqual([]);
    expect(await firingState.getActive('doomed-rule', 'AAPL')).toBe(false);
    expect((await rules.list()).map((r) => r.id)).toEqual(['survivor-rule']);
    expect(await firingState.getActive('survivor-rule', 'AAPL')).toBe(true);
  });
});
