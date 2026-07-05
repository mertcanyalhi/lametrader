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

/** The watched symbol the rule scopes to. */
const SYMBOL_ID = 'crypto:BTCUSDT';
/** The profile-attached indicator instance id both rules reference. */
const INSTANCE_ID = 'sma-inst-e2e';
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
): Omit<Rule, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    profileId: 'profile-e2e-indicator',
    name,
    scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
    condition: {
      kind: ConditionNodeKind.Leaf,
      leaf: {
        family: LeafConditionFamily.Comparison,
        operator: ComparisonOperator.Gt,
        left: {
          kind: OperandKind.IndicatorRef,
          instanceId: INSTANCE_ID,
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
 * E2E proof of #498: a rule whose operand is a profile-attached indicator
 * (`OperandKind.IndicatorRef`) actually fires once the live candle feed lifts the
 * indicator across the literal.
 *
 * Boots the real Nest app, attaches an `sma` instance to an enabled profile, and
 * starts the dormant engine ({@link RuleEngineService.start}) — which registers
 * the instance config the evaluator's lazy `IndicatorSeriesStore` view pages on
 * demand. Seeded closes put SMA(3) at 20; feeding a closing bar that lifts SMA
 * above the literal makes the lazy view compute the current value and fires the
 * rule. The negative case keeps SMA below its literal and asserts no fire.
 */
describe('indicator-operand rule firing (e2e)', () => {
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

    // An enabled profile carrying the sma instance the rules reference; the
    // engine warms the store from this at start().
    const profiles = app.get<ProfileRepository>(PROFILE_REPOSITORY);
    await profiles.save({
      id: 'profile-e2e-indicator',
      name: 'profile-e2e-indicator',
      description: '',
      enabled: true,
      scope: { type: ProfileScope.All },
      indicators: [
        {
          id: INSTANCE_ID,
          indicatorKey: 'sma',
          version: 1,
          inputs: { length: 3, source: 'close' },
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    });

    // Seed three closes so SMA(3) warms to 20 — below both rules' literals.
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

  it('fires an IndicatorRef rule once a live bar lifts the SMA above the literal', async () => {
    const created = await request(app.getHttpServer())
      .post('/rules')
      .send(indicatorRule('sma > 25', 25, 'crossed'));
    expect(created.status).toEqual(201);
    const ruleId = created.body.id as string;

    // Persist the new bar first (the lazy view pages it from the repo), then
    // feed it. SMA(3) of [20,30,40] = 30 > 25.
    const barTime = 4 * MINUTE;
    await candleRepo.save(SYMBOL_ID, Period.OneMinute, [candle(barTime, 40)]);
    wired.barBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(barTime, 40),
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

  it('does not fire an IndicatorRef rule when the SMA stays below the literal', async () => {
    const created = await request(app.getHttpServer())
      .post('/rules')
      .send(indicatorRule('sma > 1000', 1000, 'never'));
    expect(created.status).toEqual(201);

    // SMA(3) of [30,40,50] = 40, still far below 1000.
    const barTime = 5 * MINUTE;
    await candleRepo.save(SYMBOL_ID, Period.OneMinute, [candle(barTime, 50)]);
    wired.barBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(barTime, 50),
      final: true,
    });
    await wired.drain();

    expect(await eventTypesInWindow(app, barTime - 1, barTime + 1)).toEqual([]);
  });
});
