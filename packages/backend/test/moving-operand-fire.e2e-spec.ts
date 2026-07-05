import {
  ActionKind,
  type Candle,
  type CandleRepository,
  ConditionNodeKind,
  LeafConditionFamily,
  MovingOperator,
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
 * A `OncePerBarClose` `MovingUp` rule on `Close` at the 1m interval, on
 * `SYMBOL_ID`, with a `SetSymbolState` action.
 */
function movingRule(
  name: string,
  threshold: number,
  stateKey: string,
): Omit<Rule, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    profileId: 'profile-e2e-moving',
    name,
    scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
    condition: {
      kind: ConditionNodeKind.Leaf,
      leaf: {
        family: LeafConditionFamily.Moving,
        operator: MovingOperator.MovingUp,
        left: { kind: OperandKind.Close },
        threshold,
        lookbackBars: 1,
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
 * E2E proof of #499: a `MovingUp` rule on `Close` actually fires once the live
 * candle feed moves the close beyond the threshold across the lookback window.
 *
 * Boots the real Nest app, watches a symbol, seeds a flat run of 1m candles,
 * and starts the dormant engine ({@link RuleEngineService.start}). The live
 * evaluation context now warms a real multi-bar series from the candle
 * repository, so `evaluateMoving` sees the prior bar it walks back to — before
 * #499 the context held a single-point series and the operator always
 * short-circuited to `false`. The negative case keeps the move under a large
 * threshold and asserts no fire.
 */
describe('moving-operand rule firing (e2e)', () => {
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

    // An enabled profile the rules belong to. The engine only evaluates rules
    // whose parent profile is enabled (the ADR-0012 kill-switch, enforced by
    // `listEnabledForSymbol`), so without this the rules are filtered out and
    // never fire. No indicators — the Moving rules read `Close` directly.
    const profiles = app.get<ProfileRepository>(PROFILE_REPOSITORY);
    await profiles.save({
      id: 'profile-e2e-moving',
      name: 'profile-e2e-moving',
      description: '',
      enabled: true,
      scope: { type: ProfileScope.All },
      indicators: [],
      createdAt: 0,
      updatedAt: 0,
    });

    // Seed a flat run of closes so the prior bar the operator walks back to is
    // 100; a later bar that lifts the close by more than the threshold moves.
    candleRepo = app.get<CandleRepository>(CANDLE_REPOSITORY);
    await candleRepo.save(SYMBOL_ID, Period.OneMinute, [
      candle(MINUTE, 100),
      candle(2 * MINUTE, 100),
      candle(3 * MINUTE, 100),
    ]);

    wired = await app.get(RuleEngineService).start();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('fires a MovingUp rule once a live bar moves the close beyond the threshold across the lookback', async () => {
    const created = await request(app.getHttpServer())
      .post('/rules')
      .send(movingRule('close moving up 20', 20, 'moved'));
    expect(created.status).toEqual(201);
    const ruleId = created.body.id as string;

    // Persist the new bar first (the context warms the series from the repo),
    // then feed it. close 130 vs the prior bar's 100 = +30 >= 20.
    const barTime = 4 * MINUTE;
    await candleRepo.save(SYMBOL_ID, Period.OneMinute, [candle(barTime, 130)]);
    wired.barBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(barTime, 130),
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

  it('does not fire a MovingUp rule when the move stays below the threshold', async () => {
    const created = await request(app.getHttpServer())
      .post('/rules')
      .send(movingRule('close moving up 1000', 1000, 'never'));
    expect(created.status).toEqual(201);

    // close 150 vs the prior bar's 130 = +20, far below 1000.
    const barTime = 5 * MINUTE;
    await candleRepo.save(SYMBOL_ID, Period.OneMinute, [candle(barTime, 150)]);
    wired.barBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(barTime, 150),
      final: true,
    });
    await wired.drain();

    expect(await eventTypesInWindow(app, barTime - 1, barTime + 1)).toEqual([]);
  });
});
