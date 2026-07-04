import {
  ActionKind,
  ComparisonOperator,
  ConditionNodeKind,
  EvaluationTriggerKind,
  LeafConditionFamily,
  OperandKind,
  RuleEventType,
  RuleScopeKind,
  StateScope,
  StateValueType,
  SymbolType,
  TriggerKind,
  type WatchedSymbol,
} from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DomainExceptionFilter } from '../../common/domain-exception.filter.js';
import { InMemoryEventLog } from '../../common/persistence/in-memory-event-log.js';
import { buildValidationPipe } from '../../common/validation.pipe.js';
import { InMemoryWatchlistRepository } from '../../market/persistence/in-memory-watchlist.repository.js';
import { InMemoryRuleRepository } from './in-memory-rule.repository.js';
import { RuleService } from './rule.service.js';
import { RulesController } from './rules.controller.js';

/**
 * Local (Docker-free) integration proof of the rules HTTP contract: the
 * {@link RulesController} behind the real global validation pipe and exception
 * filter, over in-memory rule / event-log / watchlist stores. Pins routes, verbs,
 * status codes, and the exact rule + rule-event payload shapes — including the
 * `TickRuleNotEligibleError` 400 + `fields[]` case — for every in-scope route, so
 * the container-backed e2e tier only has to prove the Mongo wiring.
 */
describe('rules HTTP contract (integration)', () => {
  const symbolId = 'crypto:BTCUSDT';
  /** A watched crypto symbol the tick-eligibility gate resolves against. */
  const BTC: WatchedSymbol = {
    id: symbolId,
    type: SymbolType.Crypto,
    description: 'Bitcoin / TetherUS',
    exchange: 'Binance',
    currency: 'USDT',
    periods: ['1m'],
  };

  /** The minimal valid create body (Price > 100, EveryTime, SetSymbolState). */
  const ruleInput = {
    profileId: 'profile-e2e',
    name: 'price > 100',
    scope: { kind: RuleScopeKind.Symbol, symbolId },
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

  let app: INestApplication;
  let eventLog: InMemoryEventLog;

  /** Build the app over in-memory stores, seeded with `BTC` on the watchlist. */
  async function buildApp(
    opts: { watchlistSeed?: WatchedSymbol[] } = {},
  ): Promise<INestApplication> {
    eventLog = new InMemoryEventLog(() => 5_000);
    const watchlist = new InMemoryWatchlistRepository(opts.watchlistSeed ?? [BTC]);
    const service = new RuleService(new InMemoryRuleRepository(), eventLog, watchlist, {
      newId: () => 'rule-1',
      now: () => 1_000,
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [RulesController],
      providers: [{ provide: RuleService, useValue: service }],
    }).compile();
    const nestApp = moduleRef.createNestApplication();
    nestApp.useGlobalPipes(buildValidationPipe());
    nestApp.useGlobalFilters(new DomainExceptionFilter());
    await nestApp.init();
    return nestApp;
  }

  afterEach(async () => {
    await app?.close();
  });

  it('GET /rules returns [] when no rules exist', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer()).get('/rules');
    expect({ status: res.status, body: res.body }).toEqual({ status: 200, body: [] });
  });

  it('POST /rules creates a rule and returns 201 with the full stamped rule', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer()).post('/rules').send(ruleInput);
    expect({ status: res.status, body: res.body }).toEqual({
      status: 201,
      body: { ...ruleInput, id: 'rule-1', createdAt: 1_000, updatedAt: 1_000 },
    });
  });

  it('POST /rules rejects a tick-cadence rule on an unwatched scope symbol with 400 + fields[]', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer())
      .post('/rules')
      .send({ ...ruleInput, scope: { kind: RuleScopeKind.Symbol, symbolId: 'TSLA' } });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 400,
      body: {
        error: 'Tick-cadence triggers require watched symbols; not watched: TSLA.',
        fields: [{ path: 'scope.symbolId', message: 'symbol not on watchlist: TSLA' }],
      },
    });
  });

  it('POST /rules rejects a body missing a required field with the validation envelope', async () => {
    app = await buildApp();
    const { name: _omitted, ...withoutName } = ruleInput;
    const res = await request(app.getHttpServer()).post('/rules').send(withoutName);
    expect({
      status: res.status,
      error: res.body.error,
      paths: [...new Set(res.body.fields.map((f: { path: string }) => f.path))],
    }).toEqual({ status: 400, error: 'Validation failed', paths: ['name'] });
  });

  it('GET /rules/:id returns 404 { error } for an unknown id', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer()).get('/rules/nope');
    expect({ status: res.status, body: res.body }).toEqual({
      status: 404,
      body: { error: 'rule not found: nope' },
    });
  });

  it('PATCH /rules/:id merges the partial and returns the updated rule', async () => {
    app = await buildApp();
    await request(app.getHttpServer()).post('/rules').send(ruleInput);
    const res = await request(app.getHttpServer()).patch('/rules/rule-1').send({ name: 'renamed' });
    expect({ status: res.status, name: res.body.name }).toEqual({ status: 200, name: 'renamed' });
  });

  it('DELETE /rules/:id removes the rule (204) and a subsequent GET is 404', async () => {
    app = await buildApp();
    await request(app.getHttpServer()).post('/rules').send(ruleInput);
    const del = await request(app.getHttpServer()).delete('/rules/rule-1');
    expect({ status: del.status, body: del.body }).toEqual({ status: 204, body: {} });
    const after = await request(app.getHttpServer()).get('/rules/rule-1');
    expect(after.status).toEqual(404);
  });

  it('GET /rules/:id/events returns the mirrored rule events newest-first', async () => {
    app = await buildApp();
    await request(app.getHttpServer()).post('/rules').send(ruleInput);
    await eventLog.appendRuleEvent('rule-1', {
      type: RuleEventType.Fired,
      ts: 100,
      ruleId: 'rule-1',
      symbolId,
      context: {
        inboundEvent: { kind: EvaluationTriggerKind.Tick, symbolId, ts: 100, price: 101 },
        lookupSnapshot: { current: 101, open: 100, high: 102, low: 99, close: 101, volume: 5 },
      },
    });
    await eventLog.appendRuleEvent('rule-1', {
      type: RuleEventType.StateSet,
      ts: 200,
      ruleId: 'rule-1',
      symbolId,
      scope: StateScope.Symbol,
      key: 'fired',
      value: { type: StateValueType.Bool, value: true },
    });
    const res = await request(app.getHttpServer()).get('/rules/rule-1/events');
    expect({
      status: res.status,
      types: res.body.map((e: { type: string }) => e.type),
    }).toEqual({ status: 200, types: [RuleEventType.StateSet, RuleEventType.Fired] });
  });

  it('GET /symbols/:id/rule-events returns the symbol mirrored events newest-first', async () => {
    app = await buildApp();
    await eventLog.appendSymbolEvent(symbolId, {
      type: RuleEventType.Fired,
      ts: 100,
      ruleId: 'rule-1',
      symbolId,
      context: {
        inboundEvent: { kind: EvaluationTriggerKind.Tick, symbolId, ts: 100, price: 101 },
        lookupSnapshot: { current: 101, open: 100, high: 102, low: 99, close: 101, volume: 5 },
      },
    });
    const res = await request(app.getHttpServer()).get(
      `/symbols/${encodeURIComponent(symbolId)}/rule-events`,
    );
    expect({
      status: res.status,
      types: res.body.map((e: { type: string }) => e.type),
    }).toEqual({ status: 200, types: [RuleEventType.Fired] });
  });

  it('GET /symbols/:id/rule-events/count returns the mirrored event count', async () => {
    app = await buildApp();
    await eventLog.appendSymbolEvent(symbolId, {
      type: RuleEventType.Fired,
      ts: 100,
      ruleId: 'rule-1',
      symbolId,
    });
    await eventLog.appendSymbolEvent(symbolId, {
      type: RuleEventType.StateSet,
      ts: 200,
      ruleId: 'rule-1',
      symbolId,
      scope: StateScope.Symbol,
      key: 'fired',
      value: { type: StateValueType.Bool, value: true },
    });
    const res = await request(app.getHttpServer()).get(
      `/symbols/${encodeURIComponent(symbolId)}/rule-events/count`,
    );
    expect({ status: res.status, body: res.body }).toEqual({ status: 200, body: { count: 2 } });
  });

  it('GET /symbols/:id/rule-events rejects a malformed chartStates filter with 400', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer())
      .get(`/symbols/${encodeURIComponent(symbolId)}/rule-events`)
      .query({ chartStates: 'not-json' });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 400,
      body: { error: 'chartStates must be a JSON-encoded array of state keys' },
    });
  });
});
