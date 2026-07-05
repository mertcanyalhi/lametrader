import {
  ActionKind,
  type Candle,
  type CandleRepository,
  ConditionNodeKind,
  CrossingOperator,
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

/**
 * A watched symbol unique to this suite — the e2e tier shares one Testcontainers
 * Mongo across files, so a distinct id keeps another suite's candles out of this
 * one's backward walk.
 */
const SYMBOL_ID = 'crypto:CROSSUSDT';
/** One minute in ms — the watched (and rule) period. */
const MINUTE = 60_000;
/** The constant literal boundary the close crosses. */
const BOUNDARY = 100;

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
 * A `OncePerBarClose` `CrossingUp` rule on `Close` at the 1m interval, against a
 * constant literal boundary `BOUNDARY`, on `SYMBOL_ID`, with a `SetSymbolState`
 * action.
 */
function crossingUpRule(
  name: string,
  stateKey: string,
): Omit<Rule, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    profileId: 'profile-e2e-crossing',
    name,
    scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
    condition: {
      kind: ConditionNodeKind.Leaf,
      leaf: {
        family: LeafConditionFamily.Crossing,
        operator: CrossingOperator.CrossingUp,
        left: { kind: OperandKind.Close },
        right: {
          kind: OperandKind.Literal,
          value: { type: StateValueType.Number, value: BOUNDARY },
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
 * E2E proof of #501: a `CrossingUp` rule on `Close` actually fires once a live
 * candle carries the close from below the boundary to above it.
 *
 * A cross cannot be decided from the newest bar alone — it needs an older
 * baseline going back to observe the sign flip. Before #504 / #505 the live
 * evaluation context held a single-point bar series, so the backward walk past
 * the newest bar was empty, `baselineSide` stayed `0`, and `evaluateCrossing`
 * short-circuited to `false`. The context now warms a real multi-bar series from
 * the candle repository, so the operator walks back to the seeded below baseline
 * and fires. The negative case keeps the live close below the boundary and
 * asserts no fire.
 */
describe('crossing-operand rule firing (e2e)', () => {
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
      description: 'CROSS / USDT',
      exchange: 'Binance',
      currency: 'USDT',
      periods: [Period.OneMinute],
    });

    // An enabled profile the rules belong to. The engine only evaluates rules
    // whose parent profile is enabled (the ADR-0012 kill-switch, enforced by
    // `listEnabledForSymbol`), so without this the rules are filtered out and
    // never fire. No indicators — the Crossing rule reads `Close` directly.
    const profiles = app.get<ProfileRepository>(PROFILE_REPOSITORY);
    await profiles.save({
      id: 'profile-e2e-crossing',
      name: 'profile-e2e-crossing',
      description: '',
      enabled: true,
      scope: { type: ProfileScope.All },
      indicators: [],
      createdAt: 0,
      updatedAt: 0,
    });

    // Seed a flat run of closes strictly below the boundary, so the baseline the
    // operator walks back to sits below; the live bar under test then lands
    // strictly above.
    candleRepo = app.get<CandleRepository>(CANDLE_REPOSITORY);
    await candleRepo.save(SYMBOL_ID, Period.OneMinute, [
      candle(MINUTE, 90),
      candle(2 * MINUTE, 90),
      candle(3 * MINUTE, 90),
    ]);

    wired = await app.get(RuleEngineService).start();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('fires a CrossingUp rule once a live bar carries the close from below the boundary to strictly above it', async () => {
    const created = await request(app.getHttpServer())
      .post('/rules')
      .send(crossingUpRule('close crossing up 100', 'crossed'));
    expect(created.status).toEqual(201);
    const ruleId = created.body.id as string;

    // Persist the new bar first (the context warms the series from the repo),
    // then feed it. close 110 is strictly above the boundary; the seeded
    // baseline going back is 90, strictly below — so the close crosses up.
    const barTime = 4 * MINUTE;
    await candleRepo.save(SYMBOL_ID, Period.OneMinute, [candle(barTime, 110)]);
    wired.barBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(barTime, 110),
      final: true,
    });
    await wired.drain();

    expect(await eventTypesInWindow(app, barTime - 1, barTime + 1)).toEqual([
      RuleEventType.Fired,
      RuleEventType.StateSet,
    ]);

    // Retire this rule so it can't re-fire on the next test's bar.
    await request(app.getHttpServer()).delete(`/rules/${ruleId}`);
  });

  it('does not fire a CrossingUp rule when the live bar keeps the close below the boundary', async () => {
    const created = await request(app.getHttpServer())
      .post('/rules')
      .send(crossingUpRule('close still below 100', 'never'));
    expect(created.status).toEqual(201);

    // close 95 stays strictly below the boundary — no up-cross.
    const barTime = 5 * MINUTE;
    await candleRepo.save(SYMBOL_ID, Period.OneMinute, [candle(barTime, 95)]);
    wired.barBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(barTime, 95),
      final: true,
    });
    await wired.drain();

    expect(await eventTypesInWindow(app, barTime - 1, barTime + 1)).toEqual([]);
  });
});
