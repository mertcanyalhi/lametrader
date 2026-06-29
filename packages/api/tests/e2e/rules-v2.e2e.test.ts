import { createApp } from '@lametrader/api';
import { Period, RulesV2, StateValueType, SymbolType } from '@lametrader/core';
import {
  ConfigService,
  defaultIndicators,
  IndicatorService,
  MongoCandleRepository,
  MongoConfigRepository,
  MongoWatchlistRepository,
  RuleServiceV2,
  RulesV2 as RulesV2Engine,
  wireRuleEngineV2,
} from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { FastifyInstance } from 'fastify';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SYMBOL_ID = 'crypto:BTCUSDT';

/**
 * Build the v2 rule input used by the happy path test.
 *
 * Tick-cadence `EveryTime`, Price > 100, SetSymbolState — the minimal config
 * that exercises the full chain (POST → dispatcher → ActionRunner → event log).
 */
function buildRuleInput(
  overrides: Partial<Omit<RulesV2.Rule, 'id' | 'createdAt' | 'updatedAt'>> = {},
): Omit<RulesV2.Rule, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    profileId: 'profile-e2e',
    name: 'price > 100',
    scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
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
        kind: RulesV2.ActionKind.SetSymbolState,
        key: 'fired',
        value: { type: StateValueType.Bool, value: true },
      },
    ],
    enabled: true,
    order: 1,
  };
}

/**
 * E2E for the rules-v2 REST surface — real Fastify over real Mongo via
 * testcontainers, with the v2 engine wired to a per-test composition root.
 *
 * The composition root mirrors `connectServices` but skips the Binance-backed
 * default sources (`SymbolService.add` would otherwise need a real network
 * round-trip) and goes through `MongoWatchlistRepository` directly. The
 * orchestrator + bridges are the same wiring `connect.ts` runs in production.
 */
describe('/v2/rules (e2e)', () => {
  let container: StartedMongoDBContainer;
  let client: MongoClient;
  let app: FastifyInstance;
  let rulesV2: RuleServiceV2;
  let wired: ReturnType<typeof wireRuleEngineV2>;
  let stateRepo: import('@lametrader/engine').MongoStateRepository;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    const uri = `${container.getConnectionString()}?directConnection=true`;
    client = new MongoClient(uri);
    await client.connect();
    const db = client.db();

    // Seed the watchlist directly so the tick-eligibility gate passes.
    const watchlist = new MongoWatchlistRepository(db);
    await watchlist.add({
      id: SYMBOL_ID,
      type: SymbolType.Crypto,
      description: 'BTC / USDT',
      exchange: 'Binance',
      currency: 'USDT',
      periods: [Period.M1],
    });

    const config = new ConfigService(new MongoConfigRepository(db));
    const candleRepo = new MongoCandleRepository(db);
    await candleRepo.ensureIndexes();
    const { MongoStateRepository } = await import('@lametrader/engine');
    stateRepo = new MongoStateRepository(db);
    await stateRepo.ensureIndexes();
    const indicators = defaultIndicators();
    const indicatorService = new IndicatorService(indicators, watchlist, candleRepo);
    const indicatorStore = new RulesV2Engine.IndicatorSeriesStore(indicatorService);

    const ruleRepoV2 = new RulesV2Engine.MongoRuleRepository(db);
    await ruleRepoV2.ensureIndexes();
    const eventLogV2 = new RulesV2Engine.MongoEventLog(db);
    wired = wireRuleEngineV2({
      rules: ruleRepoV2,
      state: stateRepo,
      watchlist,
      eventLog: eventLogV2,
      notifier: { send: async () => {} } as never,
      candleRepository: candleRepo,
      indicatorStore,
    });
    rulesV2 = new RuleServiceV2(ruleRepoV2, eventLogV2, watchlist);

    app = createApp({
      config,
      rulesV2,
      indicators: { registry: indicators, compute: indicatorService },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await client?.close();
    await container?.stop();
  });

  it('rejects a tick-cadence rule on an unwatched symbol with fields[] and does not persist it', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v2/rules',
      payload: {
        ...buildRuleInput(),
        scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'TSLA' },
      },
    });
    expect(response.statusCode).toEqual(400);
    expect(response.json().fields).toEqual([
      { path: 'scope.symbolId', message: 'symbol not on watchlist: TSLA' },
    ]);
    const list = await app.inject({ method: 'GET', url: '/v2/rules' });
    expect(list.json().filter((r: { name: string }) => r.name === 'price > 100')).toEqual([]);
  });

  it('round-trips a v2 rule through CRUD via REST and mirrors a tick-driven fire into both event logs', async () => {
    // 1) Create.
    const ruleInput = buildRuleInput();
    const created = await app.inject({ method: 'POST', url: '/v2/rules', payload: ruleInput });
    expect(created.statusCode).toEqual(201);
    const rule = created.json();
    expect(rule.id).toBeDefined();

    // 2) List + Get.
    const list = await app.inject({ method: 'GET', url: '/v2/rules' });
    expect(list.statusCode).toEqual(200);
    expect(list.json().map((r: { id: string }) => r.id)).toEqual([rule.id]);
    const got = await app.inject({ method: 'GET', url: `/v2/rules/${rule.id}` });
    expect(got.statusCode).toEqual(200);
    expect(got.json().scope).toEqual(ruleInput.scope);

    // 3) Drive a tick through the live v2 quote bridge.
    wired.tickBridge.handleQuote({
      id: SYMBOL_ID,
      subscriptionId: 'sub-1',
      quote: {
        symbolId: SYMBOL_ID,
        price: 101,
        bid: null,
        ask: null,
        time: 1_700_000_000_000,
      },
    });
    await wired.drain();

    // 4) Event logs read.
    const ruleEvents = await app.inject({
      method: 'GET',
      url: `/v2/rules/${rule.id}/events`,
    });
    expect(ruleEvents.statusCode).toEqual(200);
    expect(ruleEvents.json().map((e: { type: RulesV2.RuleEventType }) => e.type)).toEqual([
      RulesV2.RuleEventType.Fired,
      RulesV2.RuleEventType.StateSet,
    ]);
    const symbolEvents = await app.inject({
      method: 'GET',
      url: `/v2/symbols/${SYMBOL_ID}/rule-events`,
    });
    expect(symbolEvents.statusCode).toEqual(200);
    expect(symbolEvents.json().map((e: { type: RulesV2.RuleEventType }) => e.type)).toEqual([
      RulesV2.RuleEventType.Fired,
      RulesV2.RuleEventType.StateSet,
    ]);

    // 5) PATCH + DELETE.
    const patched = await app.inject({
      method: 'PATCH',
      url: `/v2/rules/${rule.id}`,
      payload: { name: 'renamed' },
    });
    expect(patched.statusCode).toEqual(200);
    expect(patched.json().name).toEqual('renamed');
    const removed = await app.inject({ method: 'DELETE', url: `/v2/rules/${rule.id}` });
    expect(removed.statusCode).toEqual(204);
    const afterDelete = await app.inject({ method: 'GET', url: `/v2/rules/${rule.id}` });
    expect(afterDelete.statusCode).toEqual(404);
  });

  it('v1 cutover: legacy /rules and /symbols/:id/rule-events return 404 (routes are gone)', async () => {
    // Per ADR 0016 cutover (#397) the v1 REST surface is removed. These routes
    // must no longer be registered on the app — Fastify's notFoundHandler
    // returns 404 with the standard `{ error: "Route ... not found" }` body.
    const legacyList = await app.inject({ method: 'GET', url: '/rules' });
    const legacySymbolEvents = await app.inject({
      method: 'GET',
      url: `/symbols/${SYMBOL_ID}/rule-events`,
    });
    expect({
      list: legacyList.statusCode,
      symbolEvents: legacySymbolEvents.statusCode,
    }).toEqual({ list: 404, symbolEvents: 404 });
  });
});
