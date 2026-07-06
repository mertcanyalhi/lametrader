import {
  ActionKind,
  type Candle,
  type CandleRepository,
  ComparisonOperator,
  ConditionNodeKind,
  LeafConditionFamily,
  OperandKind,
  Period,
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
import { CANDLE_REPOSITORY } from '../src/market/interfaces/candle-repository.token.js';
import { WATCHLIST_REPOSITORY } from '../src/market/interfaces/watchlist-repository.token.js';

/** The watched symbol the rules scope to. */
const SYMBOL_ID = 'crypto:BTCUSDT';
/** The profile the indicators are attached to (created empty, before start). */
const PROFILE_ID = 'profile-e2e-runtime';
/** One minute in ms — the watched (and rule) period. */
const MINUTE = 60_000;

/** Build a crypto candle at `time` with a uniform OHLC around `close`. */
const candle = (time: number, close: number): Candle => ({
  type: SymbolType.Crypto,
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 10,
  quoteVolume: close * 10,
  trades: 3,
});

/**
 * A `OncePerBarClose` rule comparing `IndicatorRef(sma.value)` against a numeric
 * literal at the 1m interval, on `SYMBOL_ID`, with a `SetSymbolState` action.
 */
function indicatorRule(
  name: string,
  threshold: number,
  stateKey: string,
  instanceId: string,
): Omit<Rule, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    profileId: PROFILE_ID,
    name,
    scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
    condition: {
      kind: ConditionNodeKind.Leaf,
      leaf: {
        family: LeafConditionFamily.Comparison,
        operator: ComparisonOperator.Gt,
        left: {
          kind: OperandKind.IndicatorRef,
          instanceId,
          stateKey: 'value',
          valueType: StateValueType.Number,
        },
        right: {
          kind: OperandKind.Literal,
          value: { type: StateValueType.Number, value: threshold },
        },
        interval: Period.OneMinute,
      },
    },
    trigger: { kind: TriggerKind.OncePerBarClose, period: Period.OneMinute },
    expiration: null,
    actions: [
      {
        kind: ActionKind.SetSymbolState,
        key: stateKey,
        value: { type: StateValueType.Bool, value: true },
      },
    ],
    enabled: true,
    order: 1,
  };
}

/** Attach an `sma` instance to the profile via the HTTP API, returning its id. */
async function attachSma(app: INestApplication, length: number): Promise<string> {
  const res = await request(app.getHttpServer())
    .post(`/profiles/${PROFILE_ID}/indicators`)
    .send({ indicatorKey: 'sma', inputs: { length, source: 'close' } });
  expect(res.status).toEqual(201);
  return res.body.id as string;
}

/** Persist then feed a closing bar so the engine evaluates it. */
async function feedClose(
  candleRepo: CandleRepository,
  wired: WiredRuleEngine,
  time: number,
  close: number,
): Promise<void> {
  await candleRepo.save(SYMBOL_ID, Period.OneMinute, [candle(time, close)]);
  wired.barBridge.handleCandle({
    id: SYMBOL_ID,
    period: Period.OneMinute,
    candle: candle(time, close),
    final: true,
  });
  await wired.drain();
}

/** Read the symbol's rule-event types within a `[from, to)` window. */
async function eventTypesInWindow(
  app: INestApplication,
  from: number,
  to: number,
): Promise<RuleEventType[]> {
  const res = await request(app.getHttpServer())
    .get(`/symbols/${SYMBOL_ID}/rule-events`)
    .query({ from, to });
  expect(res.status).toEqual(200);
  return (res.body as RuleEventEntry[]).map((entry) => entry.type);
}

/**
 * E2E proof of #519: an indicator instance attached to a profile **after** the
 * rule engine has started is immediately usable by rules — no process restart.
 *
 * Boots the real Nest app, creates an empty enabled profile, and starts the
 * engine ({@link RuleEngineService.start}) — so boot-time registration snapshots
 * an empty profile and registers nothing. Only then is an `sma` instance attached
 * through `POST /profiles/:id/indicators`, which (with the fix) pushes its config
 * into the single {@link import('../src/analytics/rules/indicator-series-store.js').IndicatorSeriesStore}
 * the engine reads from. Feeding a closing bar that lifts SMA above the literal
 * fires the rule. The critical path detaches the instance again and asserts a rule
 * referencing it no longer fires.
 */
describe('runtime indicator-instance registration (e2e)', () => {
  let app: INestApplication;
  let wired: WiredRuleEngine;
  let candleRepo: CandleRepository;

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
      periods: [Period.OneMinute],
    });

    // An enabled profile carrying no indicators yet — the engine warms an empty
    // store at start(); the instances are attached afterwards through the API.
    const profiles = app.get<ProfileRepository>(PROFILE_REPOSITORY);
    await profiles.save({
      id: PROFILE_ID,
      name: PROFILE_ID,
      description: '',
      enabled: true,
      scope: { type: ProfileScope.All },
      indicators: [],
      createdAt: 0,
      updatedAt: 0,
    });

    // Seed three closes so SMA(3) warms to 20 once an instance is attached.
    candleRepo = app.get<CandleRepository>(CANDLE_REPOSITORY);
    await candleRepo.save(SYMBOL_ID, Period.OneMinute, [
      candle(MINUTE, 10),
      candle(2 * MINUTE, 20),
      candle(3 * MINUTE, 30),
    ]);

    wired = await app.get(RuleEngineService).start();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('fires a rule referencing an instance attached via the API after start, without a restart', async () => {
    const instanceId = await attachSma(app, 3);
    const created = await request(app.getHttpServer())
      .post('/rules')
      .send(indicatorRule('sma > 25', 25, 'crossed', instanceId));
    expect(created.status).toEqual(201);
    const ruleId = created.body.id as string;

    // SMA(3) of [20,30,40] = 30 > 25 — the post-start attach must have reached
    // the engine's store for this to resolve at all.
    await feedClose(candleRepo, wired, 4 * MINUTE, 40);

    expect(await eventTypesInWindow(app, 4 * MINUTE - 1, 4 * MINUTE + 1)).toEqual([
      RuleEventType.Fired,
      RuleEventType.StateSet,
    ]);

    // Retire this rule so it can't re-fire on the next test's bar.
    await request(app.getHttpServer()).delete(`/rules/${ruleId}`);
  });

  it('does not fire a rule referencing an instance detached via the API after start', async () => {
    const instanceId = await attachSma(app, 3);
    const detach = await request(app.getHttpServer()).delete(
      `/profiles/${PROFILE_ID}/indicators/${instanceId}`,
    );
    expect(detach.status).toEqual(204);

    const created = await request(app.getHttpServer())
      .post('/rules')
      .send(indicatorRule('sma > 25 (detached)', 25, 'never', instanceId));
    expect(created.status).toEqual(201);

    // SMA(3) of [30,40,50] = 40 would clear 25, but the instance was unregistered
    // on detach, so its series resolves empty and the comparison never fires.
    await feedClose(candleRepo, wired, 5 * MINUTE, 50);

    expect(await eventTypesInWindow(app, 5 * MINUTE - 1, 5 * MINUTE + 1)).toEqual([]);
  });
});
