import {
  ActionKind,
  type Candle,
  type CandleRepository,
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
  StateOperator,
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
/** The profile-attached VWMA instance id the rules reference. */
const INSTANCE_ID = 'vwma-inst-e2e';
/** One minute in ms — the watched (and rule) period. */
const MINUTE = 60_000;

/**
 * Build a crypto candle at `time` with a uniform OHLC around `close` and volume
 * 1, so with equal per-bar weight the VWMA line is the plain SMA of the close —
 * making the emitted `signal` / `above` state fields exactly predictable.
 */
const candle = (time: number, close: number): Candle => ({
  type: SymbolType.Crypto,
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  quoteVolume: close,
  trades: 1,
});

/**
 * A `OncePerBarClose` rule whose condition is a `State` leaf comparing a
 * non-numeric `IndicatorRef` (`vwma.<stateKey>`) against `literal` via `operator`
 * at the 1m interval, on `SYMBOL_ID`, with a `SetSymbolState` marker action.
 */
function stateRule(
  name: string,
  stateKey: string,
  valueType: StateValueType,
  operator: StateOperator,
  literal:
    | { type: StateValueType.Bool; value: boolean }
    | { type: StateValueType.String; value: string },
  markerKey: string,
): Omit<Rule, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    profileId: 'profile-e2e-non-numeric',
    name,
    scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
    condition: {
      kind: ConditionNodeKind.Leaf,
      leaf: {
        family: LeafConditionFamily.State,
        operator,
        left: {
          kind: OperandKind.IndicatorRef,
          instanceId: INSTANCE_ID,
          stateKey,
          valueType,
        },
        right: { kind: OperandKind.Literal, value: literal },
        interval: Period.OneMinute,
      },
    },
    trigger: { kind: TriggerKind.OncePerBarClose, period: Period.OneMinute },
    expiration: null,
    actions: [
      {
        kind: ActionKind.SetSymbolState,
        key: markerKey,
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

/** Persist `close`'s bar then feed it to the engine as a final candle; drain. */
async function feedBar(
  app: INestApplication,
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

/**
 * E2E proof of #562: a rule whose operand is a **non-numeric** profile-attached
 * indicator state field — VWMA's enum-`String` `signal` and its persistent `Bool`
 * `above` — resolves through the projected series and actually fires end-to-end.
 *
 * With uniform volume the VWMA line is the SMA of the close, so the state is
 * exact: seeded closes `[10,10,10]` warm VWMA(3) to 10; a closing bar at 11
 * up-crosses the line, emitting `signal = 'buy'` and `above = true`; a later bar
 * whose close sits below the line emits `above = false`. The negative case proves
 * a `Bool` rule stays silent when the real computed field is `false`.
 */
describe('non-numeric IndicatorRef rule firing (e2e)', () => {
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

    const profiles = app.get<ProfileRepository>(PROFILE_REPOSITORY);
    await profiles.save({
      id: 'profile-e2e-non-numeric',
      name: 'profile-e2e-non-numeric',
      description: '',
      enabled: true,
      scope: { type: ProfileScope.All },
      indicators: [
        {
          id: INSTANCE_ID,
          indicatorKey: 'vwma',
          version: 1,
          inputs: { length: 3, source: 'close', multiplier: 1, direction: 'both' },
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    });

    // Seed three closes so VWMA(3) warms to 10 — the line the next bars cross.
    candleRepo = app.get<CandleRepository>(CANDLE_REPOSITORY);
    await candleRepo.save(SYMBOL_ID, Period.OneMinute, [
      candle(MINUTE, 10),
      candle(2 * MINUTE, 10),
      candle(3 * MINUTE, 10),
    ]);

    wired = await app.get(RuleEngineService).start();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('fires an enum-String IndicatorRef rule when a live bar makes vwma.signal buy', async () => {
    const created = await request(app.getHttpServer())
      .post('/rules')
      .send(
        stateRule(
          'vwma.signal == buy',
          'signal',
          StateValueType.String,
          StateOperator.Equals,
          { type: StateValueType.String, value: 'buy' },
          'signal-buy-marked',
        ),
      );
    expect(created.status).toEqual(201);
    const ruleId = created.body.id as string;

    // VWMA(3) of [10,10,11] = 10.333, close 11 up-crosses ⇒ signal='buy'.
    const barTime = 4 * MINUTE;
    await feedBar(app, candleRepo, wired, barTime, 11);

    expect(await eventTypesInWindow(app, barTime - 1, barTime + 1)).toEqual([
      RuleEventType.Fired,
      RuleEventType.StateSet,
    ]);

    await request(app.getHttpServer()).delete(`/rules/${ruleId}`);
  });

  it('fires a Bool IndicatorRef rule when a live bar makes vwma.above true', async () => {
    const created = await request(app.getHttpServer())
      .post('/rules')
      .send(
        stateRule(
          'vwma.above == true',
          'above',
          StateValueType.Bool,
          StateOperator.Equals,
          { type: StateValueType.Bool, value: true },
          'above-true-marked',
        ),
      );
    expect(created.status).toEqual(201);
    const ruleId = created.body.id as string;

    // VWMA(3) of [10,11,15] = 12, close 15 > line ⇒ above=true.
    const barTime = 5 * MINUTE;
    await feedBar(app, candleRepo, wired, barTime, 15);

    expect(await eventTypesInWindow(app, barTime - 1, barTime + 1)).toEqual([
      RuleEventType.Fired,
      RuleEventType.StateSet,
    ]);

    await request(app.getHttpServer()).delete(`/rules/${ruleId}`);
  });

  it('does not fire a Bool IndicatorRef rule when the live bar makes vwma.above false', async () => {
    const created = await request(app.getHttpServer())
      .post('/rules')
      .send(
        stateRule(
          'vwma.above == true (silent)',
          'above',
          StateValueType.Bool,
          StateOperator.Equals,
          { type: StateValueType.Bool, value: true },
          'above-never-marked',
        ),
      );
    expect(created.status).toEqual(201);

    // VWMA(3) of [11,15,5] = 10.333, close 5 < line ⇒ above=false.
    const barTime = 6 * MINUTE;
    await feedBar(app, candleRepo, wired, barTime, 5);

    expect(await eventTypesInWindow(app, barTime - 1, barTime + 1)).toEqual([]);
  });
});
