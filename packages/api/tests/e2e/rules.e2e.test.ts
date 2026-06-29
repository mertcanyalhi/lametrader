import { createApp } from '@lametrader/api';
import {
  ActionKind,
  ComparisonOperator,
  ConditionNodeKind,
  LeafConditionFamily,
  OperandKind,
  Period,
  type Rule,
  RuleEventType,
  RuleScopeKind,
  StateValueType,
  SymbolType,
  TriggerKind,
} from '@lametrader/core';
import {
  ConfigService,
  defaultIndicators,
  IndicatorSeriesStore,
  IndicatorService,
  MongoCandleRepository,
  MongoConfigRepository,
  MongoEventLog,
  MongoRuleRepository,
  MongoWatchlistRepository,
  RuleService,
  wireRuleEngine,
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
  _overrides: Partial<Omit<Rule, 'id' | 'createdAt' | 'updatedAt'>> = {},
): Omit<Rule, 'id' | 'createdAt' | 'updatedAt'> {
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
        right: {
          kind: OperandKind.Literal,
          value: { type: StateValueType.Number, value: 100 },
        },
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
 * E2E for the rules REST surface — real Fastify over real Mongo via
 * testcontainers, with the v2 engine wired to a per-test composition root.
 *
 * The composition root mirrors `connectServices` but skips the Binance-backed
 * default sources (`SymbolService.add` would otherwise need a real network
 * round-trip) and goes through `MongoWatchlistRepository` directly. The
 * orchestrator + bridges are the same wiring `connect.ts` runs in production.
 */
describe('/rules (e2e)', () => {
  let container: StartedMongoDBContainer;
  let client: MongoClient;
  let app: FastifyInstance;
  let rules: RuleService;
  let wired: ReturnType<typeof wireRuleEngine>;
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
    const indicatorStore = new IndicatorSeriesStore(indicatorService);

    const ruleRepo = new MongoRuleRepository(db);
    await ruleRepo.ensureIndexes();
    const eventLog = new MongoEventLog(db);
    wired = wireRuleEngine({
      rules: ruleRepo,
      state: stateRepo,
      watchlist,
      eventLog: eventLog,
      notifier: { send: async () => {} } as never,
      candleRepository: candleRepo,
      indicatorStore,
    });
    rules = new RuleService(ruleRepo, eventLog, watchlist);

    app = createApp({
      config,
      rules,
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
      url: '/rules',
      payload: {
        ...buildRuleInput(),
        scope: { kind: RuleScopeKind.Symbol, symbolId: 'TSLA' },
      },
    });
    expect(response.statusCode).toEqual(400);
    expect(response.json().fields).toEqual([
      { path: 'scope.symbolId', message: 'symbol not on watchlist: TSLA' },
    ]);
    const list = await app.inject({ method: 'GET', url: '/rules' });
    expect(list.json().filter((r: { name: string }) => r.name === 'price > 100')).toEqual([]);
  });

  it('round-trips a v2 rule through CRUD via REST and mirrors a tick-driven fire into both event logs', async () => {
    // 1) Create.
    const ruleInput = buildRuleInput();
    const created = await app.inject({ method: 'POST', url: '/rules', payload: ruleInput });
    expect(created.statusCode).toEqual(201);
    const rule = created.json();
    expect(rule.id).toBeDefined();

    // 2) List + Get.
    const list = await app.inject({ method: 'GET', url: '/rules' });
    expect(list.statusCode).toEqual(200);
    expect(list.json().map((r: { id: string }) => r.id)).toEqual([rule.id]);
    const got = await app.inject({ method: 'GET', url: `/rules/${rule.id}` });
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
      url: `/rules/${rule.id}/events`,
    });
    expect(ruleEvents.statusCode).toEqual(200);
    expect(ruleEvents.json().map((e: { type: RuleEventType }) => e.type)).toEqual([
      RuleEventType.Fired,
      RuleEventType.StateSet,
    ]);
    const symbolEvents = await app.inject({
      method: 'GET',
      url: `/symbols/${SYMBOL_ID}/rule-events`,
    });
    expect(symbolEvents.statusCode).toEqual(200);
    expect(symbolEvents.json().map((e: { type: RuleEventType }) => e.type)).toEqual([
      RuleEventType.Fired,
      RuleEventType.StateSet,
    ]);

    // 5) PATCH + DELETE.
    const patched = await app.inject({
      method: 'PATCH',
      url: `/rules/${rule.id}`,
      payload: { name: 'renamed' },
    });
    expect(patched.statusCode).toEqual(200);
    expect(patched.json().name).toEqual('renamed');
    const removed = await app.inject({ method: 'DELETE', url: `/rules/${rule.id}` });
    expect(removed.statusCode).toEqual(204);
    const afterDelete = await app.inject({ method: 'GET', url: `/rules/${rule.id}` });
    expect(afterDelete.statusCode).toEqual(404);
  });
});
