import {
  RuleEventType,
  StateScope,
  StateValueType,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DomainExceptionFilter } from '../common/domain-exception.filter.js';
import { InMemoryEventLog } from '../common/persistence/in-memory-event-log.js';
import { buildValidationPipe } from '../common/validation.pipe.js';
import { WATCHLIST_REPOSITORY } from '../market/interfaces/watchlist-repository.token.js';
import { InMemoryWatchlistRepository } from '../market/persistence/in-memory-watchlist.repository.js';
import { InMemoryStateRepository } from './in-memory-state.repository.js';
import { StateController } from './state.controller.js';
import { StateHistoryService } from './state-history.service.js';
import { STATE_REPOSITORY } from './state-repository.token.js';

/**
 * Local (Docker-free) integration proof of the state HTTP contract: the
 * {@link StateController} behind the real global validation pipe and exception
 * filter, over an in-memory state store, watchlist, and symbol-event log. Pins
 * routes, verbs, status codes, and the exact payload shapes (including the tagged
 * {@link import('@lametrader/core').StateValue} serialization) for every in-scope
 * route so the container-backed e2e tier only has to prove the Mongo wiring.
 */
describe('state HTTP contract (integration)', () => {
  const symbolId = 'crypto:BTCUSDT';
  /** A watched crypto symbol the symbol-scoped reads resolve against. */
  const BTC: WatchedSymbol = {
    id: symbolId,
    type: SymbolType.Crypto,
    description: 'Bitcoin / TetherUS',
    exchange: 'Binance',
    currency: 'USDT',
    periods: ['1h', '1d'],
  };

  let app: INestApplication;
  let state: InMemoryStateRepository;
  let events: InMemoryEventLog;

  /** Build the app over in-memory stores, seeded with `BTC` on the watchlist. */
  async function buildApp(
    opts: { watchlistSeed?: WatchedSymbol[] } = {},
  ): Promise<INestApplication> {
    state = new InMemoryStateRepository();
    events = new InMemoryEventLog();
    const watchlist = new InMemoryWatchlistRepository(opts.watchlistSeed ?? [BTC]);
    const moduleRef = await Test.createTestingModule({
      controllers: [StateController],
      providers: [
        { provide: STATE_REPOSITORY, useValue: state },
        { provide: WATCHLIST_REPOSITORY, useValue: watchlist },
        { provide: StateHistoryService, useValue: new StateHistoryService(events) },
      ],
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

  it('GET /profiles/:profileId/state/global returns {} when no keys have been set', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer()).get('/profiles/profile-1/state/global');
    expect({ status: res.status, body: res.body }).toEqual({ status: 200, body: {} });
  });

  it('GET /profiles/:profileId/state/global returns every set global key', async () => {
    app = await buildApp();
    await state.setGlobalState(
      'profile-1',
      'regime',
      { type: StateValueType.String, value: 'risk-on' },
      100,
    );
    await state.setGlobalState(
      'profile-1',
      'lastSweep',
      { type: StateValueType.Number, value: 42 },
      101,
    );
    const res = await request(app.getHttpServer()).get('/profiles/profile-1/state/global');
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: {
        regime: { type: 'string', value: 'risk-on' },
        lastSweep: { type: 'number', value: 42 },
      },
    });
  });

  it('GET /profiles/:profileId/state/global returns {} for a different profileId (isolation)', async () => {
    app = await buildApp();
    await state.setGlobalState(
      'profile-1',
      'regime',
      { type: StateValueType.String, value: 'risk-on' },
      100,
    );
    const res = await request(app.getHttpServer()).get('/profiles/profile-99/state/global');
    expect({ status: res.status, body: res.body }).toEqual({ status: 200, body: {} });
  });

  it('GET /symbols/:id/state returns the symbol state map for the profile', async () => {
    app = await buildApp();
    await state.setSymbolState(
      'profile-1',
      symbolId,
      'armed',
      { type: StateValueType.Bool, value: true },
      100,
    );
    const res = await request(app.getHttpServer())
      .get(`/symbols/${encodeURIComponent(symbolId)}/state`)
      .query({ profileId: 'profile-1' });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: { armed: { type: 'bool', value: true } },
    });
  });

  it('GET /symbols/:id/state returns {} when the symbol has no state under the profile', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer())
      .get(`/symbols/${encodeURIComponent(symbolId)}/state`)
      .query({ profileId: 'profile-1' });
    expect({ status: res.status, body: res.body }).toEqual({ status: 200, body: {} });
  });

  it('GET /symbols/:id/state returns 404 { error } when the symbol is not watched', async () => {
    app = await buildApp({ watchlistSeed: [] });
    const res = await request(app.getHttpServer())
      .get(`/symbols/${encodeURIComponent(symbolId)}/state`)
      .query({ profileId: 'profile-1' });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 404,
      body: { error: `symbol not watched: ${symbolId}` },
    });
  });

  it('GET /symbols/:id/state rejects a missing profileId with the validation envelope', async () => {
    app = await buildApp();
    const res = await request(app.getHttpServer()).get(
      `/symbols/${encodeURIComponent(symbolId)}/state`,
    );
    expect({
      status: res.status,
      error: res.body.error,
      paths: res.body.fields.map((f: { path: string }) => f.path),
    }).toEqual({ status: 400, error: 'Validation failed', paths: ['profileId'] });
  });

  it('GET /symbols/:id/state-keys returns the alphabetical catalog of state keys', async () => {
    app = await buildApp();
    await events.appendSymbolEvent(symbolId, {
      type: RuleEventType.StateSet,
      ruleId: 'rule-a',
      symbolId,
      ts: 100,
      scope: StateScope.Symbol,
      key: 'last_signal',
      value: { type: StateValueType.String, value: 'buy' },
    });
    await events.appendSymbolEvent(symbolId, {
      type: RuleEventType.StateSet,
      ruleId: 'rule-b',
      symbolId,
      ts: 200,
      scope: StateScope.Symbol,
      key: 'cooldown',
      value: { type: StateValueType.Number, value: 5 },
    });
    const res = await request(app.getHttpServer()).get(
      `/symbols/${encodeURIComponent(symbolId)}/state-keys`,
    );
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: [
        { key: 'cooldown', valueType: 'number' },
        { key: 'last_signal', valueType: 'string' },
      ],
    });
  });

  it('GET /symbols/:id/state-keys returns 404 when the symbol is not watched', async () => {
    app = await buildApp({ watchlistSeed: [] });
    const res = await request(app.getHttpServer()).get(
      `/symbols/${encodeURIComponent(symbolId)}/state-keys`,
    );
    expect({ status: res.status, body: res.body }).toEqual({
      status: 404,
      body: { error: `symbol not watched: ${symbolId}` },
    });
  });

  it('GET /symbols/:id/state/:key/series returns the StateSet-then-StateRemoved series ordered by ts', async () => {
    app = await buildApp();
    await events.appendSymbolEvent(symbolId, {
      type: RuleEventType.StateSet,
      ruleId: 'rule-a',
      symbolId,
      ts: 100,
      scope: StateScope.Symbol,
      key: 'last_signal',
      value: { type: StateValueType.String, value: 'buy' },
    });
    await events.appendSymbolEvent(symbolId, {
      type: RuleEventType.StateRemoved,
      ruleId: 'rule-a',
      symbolId,
      ts: 300,
      scope: StateScope.Symbol,
      key: 'last_signal',
    });
    const res = await request(app.getHttpServer()).get(
      `/symbols/${encodeURIComponent(symbolId)}/state/last_signal/series`,
    );
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: [
        { ts: 100, value: { type: 'string', value: 'buy' } },
        { ts: 300, value: null },
      ],
    });
  });

  it('GET /symbols/:id/state/:key/series honors the [from, to) window', async () => {
    app = await buildApp();
    await events.appendSymbolEvent(symbolId, {
      type: RuleEventType.StateSet,
      ruleId: 'rule-a',
      symbolId,
      ts: 100,
      scope: StateScope.Symbol,
      key: 'count',
      value: { type: StateValueType.Number, value: 1 },
    });
    await events.appendSymbolEvent(symbolId, {
      type: RuleEventType.StateSet,
      ruleId: 'rule-a',
      symbolId,
      ts: 500,
      scope: StateScope.Symbol,
      key: 'count',
      value: { type: StateValueType.Number, value: 2 },
    });
    const res = await request(app.getHttpServer())
      .get(`/symbols/${encodeURIComponent(symbolId)}/state/count/series`)
      .query({ from: 500 });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: [{ ts: 500, value: { type: 'number', value: 2 } }],
    });
  });

  it('GET /symbols/:id/state/:key/series returns 404 when the symbol is not watched', async () => {
    app = await buildApp({ watchlistSeed: [] });
    const res = await request(app.getHttpServer()).get(
      `/symbols/${encodeURIComponent(symbolId)}/state/any/series`,
    );
    expect({ status: res.status, body: res.body }).toEqual({
      status: 404,
      body: { error: `symbol not watched: ${symbolId}` },
    });
  });
});
