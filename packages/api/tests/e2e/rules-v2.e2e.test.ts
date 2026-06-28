import { createApp } from '@lametrader/api';
import {
  Period,
  RulesV2 as RulesV2Core,
  StateValueType,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import { connectServices, loadSettings, MongoWatchlistRepository } from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { FastifyInstance } from 'fastify';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { pollIntervals } = loadSettings({});

/**
 * E2E for the `/v2/rules*` surface from the API consumer's perspective.
 *
 * Real Fastify over real Mongo (Testcontainers) wired through the full
 * `connectServices` graph so the v2 orchestrator is live: a `POST /v2/rules`
 * creates a tick rule, a synthetic quote injected via the wired
 * `tickBridge.handleQuote` drives the orchestrator, and the events are read
 * back through `GET /v2/rules/:id/events` and `GET /v2/symbols/:id/rule-events`.
 *
 * Watchlist fixtures are inserted via a sibling `MongoWatchlistRepository`
 * pointed at the same database — bypassing `SymbolService.add` (which would
 * call out to live market-data sources) keeps the test hermetic.
 */
describe('rules-v2 API (e2e)', () => {
  let container: StartedMongoDBContainer;
  let close: () => Promise<void>;
  let app: FastifyInstance;
  let wired: Awaited<ReturnType<typeof connectServices>>;
  let testClient: MongoClient;
  let watchlist: MongoWatchlistRepository;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    const uri = `${container.getConnectionString()}?directConnection=true`;
    wired = await connectServices(uri, { pollIntervals });
    close = wired.close;
    testClient = new MongoClient(uri);
    await testClient.connect();
    watchlist = new MongoWatchlistRepository(testClient.db());
    app = createApp({
      config: wired.config,
      symbols: wired.symbols,
      profiles: wired.profiles,
      rules: wired.rules,
      rulesV2: wired.rulesV2,
      state: wired.state,
      backfill: wired.backfill,
      telegramDestinations: wired.telegramDestinations,
      indicators: { registry: wired.indicators, compute: wired.indicatorService },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await testClient?.close();
    await close?.();
    await container?.stop();
  });

  /** Insert a watchlist document directly so the v2 tick gate passes. */
  const watch = async (id: string): Promise<void> => {
    const symbol: WatchedSymbol = {
      id,
      type: SymbolType.Crypto,
      description: id,
      exchange: 'test',
      periods: [Period.OneMinute],
    };
    await watchlist.add(symbol);
  };

  /** Build a tick-cadence rule body bound to one symbol. */
  const tickRuleBody = (overrides: { profileId: string; symbolId: string; name?: string }) => ({
    profileId: overrides.profileId,
    name: overrides.name ?? 'price-gt-100',
    scope: { kind: RulesV2Core.RuleScopeKind.Symbol, symbolId: overrides.symbolId },
    condition: {
      kind: RulesV2Core.ConditionNodeKind.Leaf,
      leaf: {
        family: RulesV2Core.LeafConditionFamily.Comparison,
        operator: RulesV2Core.ComparisonOperator.Gt,
        left: { kind: RulesV2Core.OperandKind.Price },
        right: {
          kind: RulesV2Core.OperandKind.Literal,
          value: { type: StateValueType.Number, value: 100 },
        },
      },
    },
    trigger: { kind: RulesV2Core.TriggerKind.EveryTime },
    expiration: null,
    actions: [
      {
        kind: RulesV2Core.ActionKind.SetSymbolState,
        key: 'phase',
        value: { type: StateValueType.String, value: 'on' },
      },
    ],
    enabled: true,
    order: 1,
  });

  it('runs a full CRUD round-trip via REST (create → list → get → patch → delete) on /v2/rules with a Symbol-scoped tick-cadence rule on a watched symbol', async () => {
    await watch('crud-sym');

    const create = await app.inject({
      method: 'POST',
      url: '/v2/rules',
      payload: tickRuleBody({ profileId: 'crud-p', symbolId: 'crud-sym' }),
    });
    const id = (create.json() as { id: string }).id;

    const list = await app.inject({ method: 'GET', url: '/v2/rules?profileId=crud-p' });
    const get = await app.inject({ method: 'GET', url: `/v2/rules/${id}` });
    const patch = await app.inject({
      method: 'PATCH',
      url: `/v2/rules/${id}`,
      payload: { enabled: false },
    });
    const remove = await app.inject({ method: 'DELETE', url: `/v2/rules/${id}` });
    const getAfterDelete = await app.inject({ method: 'GET', url: `/v2/rules/${id}` });

    expect({
      createStatus: create.statusCode,
      listStatus: list.statusCode,
      listIds: (list.json() as Array<{ id: string }>).map((rule) => rule.id),
      getStatus: get.statusCode,
      getId: (get.json() as { id: string }).id,
      patchStatus: patch.statusCode,
      patchEnabled: (patch.json() as { enabled: boolean }).enabled,
      removeStatus: remove.statusCode,
      getAfterDeleteStatus: getAfterDelete.statusCode,
    }).toEqual({
      createStatus: 201,
      listStatus: 200,
      listIds: [id],
      getStatus: 200,
      getId: id,
      patchStatus: 200,
      patchEnabled: false,
      removeStatus: 204,
      getAfterDeleteStatus: 404,
    });
  });

  it('rejects POST /v2/rules with a tick-cadence trigger on an unwatched symbol with a 400 carrying a fields[] entry pointing at scope.symbolId, and does NOT persist the rule', async () => {
    const before = await app.inject({ method: 'GET', url: '/v2/rules?profileId=tg-p' });

    const create = await app.inject({
      method: 'POST',
      url: '/v2/rules',
      payload: tickRuleBody({ profileId: 'tg-p', symbolId: 'never-watched' }),
    });

    const after = await app.inject({ method: 'GET', url: '/v2/rules?profileId=tg-p' });
    const body = create.json() as {
      error: string;
      fields: Array<{ path: string; message: string }>;
    };
    expect({
      statusCode: create.statusCode,
      fields: body.fields,
      countBefore: (before.json() as unknown[]).length,
      countAfter: (after.json() as unknown[]).length,
    }).toEqual({
      statusCode: 400,
      fields: [{ path: 'scope.symbolId', message: 'Symbol "never-watched" is not watched.' }],
      countBefore: 0,
      countAfter: 0,
    });
  });

  it('returns 400 with one fields[] entry per offending field when POST /v2/rules body fails schema validation (empty actions)', async () => {
    await watch('schema-sym');

    const create = await app.inject({
      method: 'POST',
      url: '/v2/rules',
      payload: {
        ...tickRuleBody({ profileId: 'schema-p', symbolId: 'schema-sym' }),
        actions: [],
      },
    });

    const body = create.json() as {
      error: string;
      fields: Array<{ path: string; message: string }>;
    };
    expect({
      statusCode: create.statusCode,
      hasError: typeof body.error === 'string' && body.error.length > 0,
      actionsField: body.fields.find((field) => field.path === 'actions') ?? null,
    }).toEqual({
      statusCode: 400,
      hasError: true,
      actionsField: { path: 'actions', message: 'must NOT have fewer than 1 items' },
    });
  });

  it('persists Fired + StateSet entries on the rule and symbol logs when a TickEvent above the Price>100 threshold is driven into the live v2 orchestrator via the wired tickBridge', async () => {
    await watch('fire-sym');
    const create = await app.inject({
      method: 'POST',
      url: '/v2/rules',
      payload: tickRuleBody({ profileId: 'fire-p', symbolId: 'fire-sym', name: 'fire-rule' }),
    });
    const ruleId = (create.json() as { id: string }).id;

    wired.wiredRuleEngineV2.tickBridge.handleQuote({
      id: 'fire-sym',
      subscriptionId: 'sub-e2e',
      period: Period.OneMinute,
      quote: { time: 5_000, price: 120 },
    });
    await wired.wiredRuleEngineV2.drain();

    const ruleEvents = await app.inject({ method: 'GET', url: `/v2/rules/${ruleId}/events` });
    const symbolEvents = await app.inject({
      method: 'GET',
      url: '/v2/symbols/fire-sym/rule-events',
    });

    expect({
      ruleStatus: ruleEvents.statusCode,
      ruleTypes: (ruleEvents.json() as Array<{ type: string }>).map((entry) => entry.type),
      symbolStatus: symbolEvents.statusCode,
      symbolTypes: (symbolEvents.json() as Array<{ type: string }>).map((entry) => entry.type),
    }).toEqual({
      ruleStatus: 200,
      ruleTypes: [RulesV2Core.RuleEventType.Fired, RulesV2Core.RuleEventType.StateSet],
      symbolStatus: 200,
      symbolTypes: [RulesV2Core.RuleEventType.Fired, RulesV2Core.RuleEventType.StateSet],
    });
  });
});
