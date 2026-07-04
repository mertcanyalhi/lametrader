import {
  ActionKind,
  ComparisonOperator,
  ConditionNodeKind,
  LeafConditionFamily,
  OperandKind,
  type ProfileRepository,
  ProfileScope,
  type Rule,
  RuleEventType,
  RuleScopeKind,
  StateValueType,
  SymbolType,
  TriggerKind,
  type WatchlistRepository,
} from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import request from 'supertest';
import { PROFILE_REPOSITORY } from '../src/analytics/interfaces/profile-repository.token.js';
import { AppModule } from '../src/app.module.js';
import { WATCHLIST_REPOSITORY } from '../src/market/interfaces/watchlist-repository.token.js';
import { RuleEngineService } from '../src/rules/rule-engine.service.js';

const SYMBOL_ID = 'crypto:BTCUSDT';

/**
 * The rule input used by the happy path — tick-cadence `EveryTime`, Price > 100,
 * `SetSymbolState`: the minimal config that exercises the full chain (POST →
 * dispatcher → ActionRunner → event log).
 */
function buildRuleInput(): Omit<Rule, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    profileId: 'profile-e2e',
    name: 'price > 100',
    scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
    condition: {
      kind: ConditionNodeKind.Leaf,
      leaf: {
        family: LeafConditionFamily.Comparison,
        operator: ComparisonOperator.Gt,
        left: { kind: OperandKind.Price },
        right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 100 } },
      },
    },
    trigger: { kind: TriggerKind.EveryTime },
    expiration: null,
    actions: [
      {
        kind: ActionKind.SetSymbolState,
        key: 'fired',
        value: { type: StateValueType.Bool, value: true },
      },
    ],
    enabled: true,
    order: 1,
  };
}

/**
 * E2E for the rules REST surface — the real Nest app over a real Mongo
 * (Testcontainers). The rule store, event log, and watchlist come from the booted
 * {@link AppModule}; the fire path is driven by composing the dormant engine
 * ({@link RuleEngineService.start}) and feeding a candle through its bar bridge,
 * exactly the wiring the cutover stage (#490) will run at boot. Mirrors the old
 * Fastify `rules.e2e.test.ts`.
 */
describe('/rules (e2e)', () => {
  let container: StartedMongoDBContainer;
  let app: INestApplication;
  let ruleEngine: RuleEngineService;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    process.env.MONGODB_URI = `${container.getConnectionString()}/?directConnection=true`;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    // Seed the watchlist directly so the tick-eligibility gate passes.
    const watchlist = app.get<WatchlistRepository>(WATCHLIST_REPOSITORY);
    await watchlist.add({
      id: SYMBOL_ID,
      type: SymbolType.Crypto,
      description: 'BTC / USDT',
      exchange: 'Binance',
      currency: 'USDT',
      periods: ['1m'],
    });
    // Seed the (enabled) parent profile so the orchestrator's profile-enabled
    // kill-switch (ADR-0012 #5) admits the rule at fire time — production wires
    // the rule store with the profile repo, unlike the old test's bare repo.
    const profiles = app.get<ProfileRepository>(PROFILE_REPOSITORY);
    await profiles.save({
      id: 'profile-e2e',
      name: 'profile-e2e',
      description: '',
      enabled: true,
      scope: { type: ProfileScope.All },
      indicators: [],
      chartStates: [],
      createdAt: 0,
      updatedAt: 0,
    });
    ruleEngine = app.get(RuleEngineService);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  it('rejects a tick-cadence rule on an unwatched symbol with fields[] and does not persist it', async () => {
    const res = await request(app.getHttpServer())
      .post('/rules')
      .send({ ...buildRuleInput(), scope: { kind: RuleScopeKind.Symbol, symbolId: 'TSLA' } });
    expect(res.status).toEqual(400);
    expect(res.body.fields).toEqual([
      { path: 'scope.symbolId', message: 'symbol not on watchlist: TSLA' },
    ]);
    const list = await request(app.getHttpServer()).get('/rules');
    expect(list.body.filter((r: { name: string }) => r.name === 'price > 100')).toEqual([]);
  });

  it('round-trips a rule through CRUD via REST and mirrors a tick-driven fire into both event logs', async () => {
    // 1) Create.
    const created = await request(app.getHttpServer()).post('/rules').send(buildRuleInput());
    expect(created.status).toEqual(201);
    const ruleId = created.body.id as string;
    expect(ruleId).toBeDefined();

    // 2) List + Get.
    const list = await request(app.getHttpServer()).get('/rules');
    expect({ status: list.status, ids: list.body.map((r: { id: string }) => r.id) }).toEqual({
      status: 200,
      ids: [ruleId],
    });
    const got = await request(app.getHttpServer()).get(`/rules/${ruleId}`);
    expect({ status: got.status, scope: got.body.scope }).toEqual({
      status: 200,
      scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
    });

    // 3) Count starts at 0 before any fire.
    const initialCount = await request(app.getHttpServer()).get(
      `/symbols/${SYMBOL_ID}/rule-events/count`,
    );
    expect({ status: initialCount.status, body: initialCount.body }).toEqual({
      status: 200,
      body: { count: 0 },
    });

    // 4) Compose the dormant engine and drive a tick via a poll — the candle's
    // close is the tick price.
    const wired = await ruleEngine.start();
    wired.barBridge.handleCandle({
      id: SYMBOL_ID,
      period: '1m',
      candle: { time: 1_700_000_000_000, open: 101, high: 101, low: 101, close: 101, volume: 10 },
      final: false,
    });
    await wired.drain();

    // 5) Event logs read — a Fired umbrella + the StateSet action, newest-first.
    const ruleEvents = await request(app.getHttpServer()).get(`/rules/${ruleId}/events`);
    expect({
      status: ruleEvents.status,
      types: ruleEvents.body.map((e: { type: RuleEventType }) => e.type),
    }).toEqual({ status: 200, types: [RuleEventType.Fired, RuleEventType.StateSet] });
    const symbolEvents = await request(app.getHttpServer()).get(
      `/symbols/${SYMBOL_ID}/rule-events`,
    );
    expect({
      status: symbolEvents.status,
      types: symbolEvents.body.map((e: { type: RuleEventType }) => e.type),
    }).toEqual({ status: 200, types: [RuleEventType.Fired, RuleEventType.StateSet] });

    // 6) After the fire the count endpoint matches the mirrored row count.
    const finalCount = await request(app.getHttpServer()).get(
      `/symbols/${SYMBOL_ID}/rule-events/count`,
    );
    expect({ status: finalCount.status, body: finalCount.body }).toEqual({
      status: 200,
      body: { count: 2 },
    });

    // 7) PATCH + DELETE.
    const patched = await request(app.getHttpServer())
      .patch(`/rules/${ruleId}`)
      .send({ name: 'renamed' });
    expect({ status: patched.status, name: patched.body.name }).toEqual({
      status: 200,
      name: 'renamed',
    });
    const removed = await request(app.getHttpServer()).delete(`/rules/${ruleId}`);
    expect(removed.status).toEqual(204);
    const afterDelete = await request(app.getHttpServer()).get(`/rules/${ruleId}`);
    expect(afterDelete.status).toEqual(404);
  });
});
