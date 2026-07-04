import {
  ActionKind,
  ComparisonOperator,
  ConditionNodeKind,
  LeafConditionFamily,
  OperandKind,
  type ProfileRepository,
  ProfileScope,
  type Rule,
  type RuleEventEntry,
  RuleEventType,
  RuleScopeKind,
  StateValueType,
  SymbolType,
  TriggerKind,
  type WatchlistRepository,
} from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PROFILE_REPOSITORY } from '../src/analytics/interfaces/profile-repository.token.js';
import { RuleEngineService } from '../src/analytics/rules/rule-engine.service.js';
import type { WiredRuleEngine } from '../src/analytics/rules/wire/wire-rule-engine.js';
import { AppModule } from '../src/app.module.js';
import { WATCHLIST_REPOSITORY } from '../src/market/interfaces/watchlist-repository.token.js';

/** The watched symbol the rule scopes to. */
const SYMBOL_ID = 'crypto:BTCUSDT';

/**
 * A tick-cadence `EveryTime` `Price > 100` rule on `SYMBOL_ID` with a
 * `SetSymbolState` action; `overrides` swap in a different name / action set.
 */
function buildRuleInput(
  overrides: Partial<Omit<Rule, 'id' | 'createdAt' | 'updatedAt'>> = {},
): Omit<Rule, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    profileId: 'profile-e2e-markers',
    name: 'price > 100 marker',
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
    ...overrides,
  };
}

/**
 * E2E for the chart's rule-event marker REST pipeline — the windowed
 * `GET /symbols/:id/rule-events` read (`from` / `to` window + `chartStates`
 * filter) and its critical failure modes (non-numeric `from` → 400, malformed
 * `chartStates` → 400). Ported from the old Fastify
 * `chart-rule-event-markers.e2e.test.ts` minus the live `/stream`
 * `subscribe-rule-event` WebSocket frames — that surface is ported with the
 * stream stage, not #488.
 *
 * Fires are driven by composing the dormant engine ({@link RuleEngineService.start})
 * and feeding a candle through its bar bridge; distinct tick timestamps keep each
 * fire's events in their own window.
 */
describe('chart rule-event markers (e2e)', () => {
  let app: INestApplication;
  let wired: WiredRuleEngine;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
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
    // kill-switch (ADR-0012 #5) admits the rule at fire time.
    const profiles = app.get<ProfileRepository>(PROFILE_REPOSITORY);
    await profiles.save({
      id: 'profile-e2e-markers',
      name: 'profile-e2e-markers',
      description: '',
      enabled: true,
      scope: { type: ProfileScope.All },
      indicators: [],
      chartStates: [],
      createdAt: 0,
      updatedAt: 0,
    });
    wired = await app.get(RuleEngineService).start();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('windows the symbol mirrored events log on [from, to) for a tick-driven fire', async () => {
    const created = await request(app.getHttpServer()).post('/rules').send(buildRuleInput());
    expect(created.status).toEqual(201);
    const ruleId = created.body.id as string;

    const tickTs = 1_700_000_500_000;
    // The windowed range is empty before any fire.
    const before = await request(app.getHttpServer())
      .get(`/symbols/${SYMBOL_ID}/rule-events`)
      .query({ from: 0, to: tickTs + 1 });
    expect({ status: before.status, body: before.body }).toEqual({ status: 200, body: [] });

    // Drive a tick via a poll — the candle's close is the tick price.
    wired.barBridge.handleCandle({
      id: SYMBOL_ID,
      period: '1m',
      candle: { time: tickTs, open: 101, high: 101, low: 101, close: 101, volume: 10 },
      final: false,
    });
    await wired.drain();

    // The windowed range now reads back those entries (newest-first).
    const windowed = await request(app.getHttpServer())
      .get(`/symbols/${SYMBOL_ID}/rule-events`)
      .query({ from: tickTs - 1, to: tickTs + 1 });
    expect({
      status: windowed.status,
      types: windowed.body.map((e: RuleEventEntry) => e.type),
    }).toEqual({ status: 200, types: [RuleEventType.Fired, RuleEventType.StateSet] });

    // A window that excludes the tick returns nothing — the filter applied.
    const beforeTick = await request(app.getHttpServer())
      .get(`/symbols/${SYMBOL_ID}/rule-events`)
      .query({ from: 0, to: tickTs });
    expect(beforeTick.body).toEqual([]);

    await request(app.getHttpServer()).delete(`/rules/${ruleId}`);
  });

  it('rejects a non-numeric from on the symbol rule-events endpoint with 400', async () => {
    const res = await request(app.getHttpServer())
      .get(`/symbols/${SYMBOL_ID}/rule-events`)
      .query({ from: 'foo' });
    expect(res.status).toEqual(400);
  });

  it('filters the windowed read to the profile chartStates, dropping other keys and non-state events', async () => {
    const created = await request(app.getHttpServer())
      .post('/rules')
      .send(
        buildRuleInput({
          name: 'two-state marker',
          actions: [
            {
              kind: ActionKind.SetSymbolState,
              key: 'fired',
              value: { type: StateValueType.Bool, value: true },
            },
            {
              kind: ActionKind.SetSymbolState,
              key: 'trend',
              value: { type: StateValueType.Bool, value: true },
            },
          ],
        }),
      );
    expect(created.status).toEqual(201);
    const ruleId = created.body.id as string;

    // A distinct `ts` keeps this fire out of the first test's window.
    const tickTs = 1_700_000_600_000;
    wired.barBridge.handleCandle({
      id: SYMBOL_ID,
      period: '1m',
      candle: { time: tickTs, open: 102, high: 102, low: 102, close: 102, volume: 10 },
      final: false,
    });
    await wired.drain();

    // Filtered to `['trend']`: only the matching StateSet — the `fired` StateSet
    // and the umbrella `Fired` are dropped.
    const filtered = await request(app.getHttpServer())
      .get(`/symbols/${SYMBOL_ID}/rule-events`)
      .query({ from: tickTs - 1, to: tickTs + 1, chartStates: JSON.stringify(['trend']) });
    expect({
      status: filtered.status,
      entries: filtered.body.map((e: RuleEventEntry & { key?: string }) => ({
        type: e.type,
        key: e.key,
      })),
    }).toEqual({ status: 200, entries: [{ type: RuleEventType.StateSet, key: 'trend' }] });

    // An empty chartStates renders nothing.
    const empty = await request(app.getHttpServer())
      .get(`/symbols/${SYMBOL_ID}/rule-events`)
      .query({ from: tickTs - 1, to: tickTs + 1, chartStates: '[]' });
    expect(empty.body).toEqual([]);

    await request(app.getHttpServer()).delete(`/rules/${ruleId}`);
  });

  it('rejects a malformed chartStates on the symbol rule-events endpoint with 400', async () => {
    const res = await request(app.getHttpServer())
      .get(`/symbols/${SYMBOL_ID}/rule-events`)
      .query({ chartStates: 'not-json' });
    expect(res.status).toEqual(400);
  });
});
