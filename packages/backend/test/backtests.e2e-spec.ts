import {
  ActionKind,
  type BacktestStrategy,
  type BacktestStrategyRepository,
  type Candle,
  type CandleRepository,
  ComparisonOperator,
  ConditionNodeKind,
  type EventLog,
  LeafConditionFamily,
  OperandKind,
  Period,
  type Profile,
  type ProfileRepository,
  ProfileScope,
  type Rule,
  type RuleEventEntry,
  type RuleRepository,
  RuleScopeKind,
  type StateRepository,
  StateValueType,
  SymbolType,
  TriggerKind,
  type WatchlistRepository,
} from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { Model } from 'mongoose';
import request from 'supertest';
import { BacktestDoc } from '../src/analytics/backtesting/backtest.schema.js';
import { BacktestEventDoc } from '../src/analytics/backtesting/backtest-event.schema.js';
import { BACKTEST_STRATEGY_REPOSITORY } from '../src/analytics/backtesting/backtest-strategy-repository.token.js';
import { PROFILE_REPOSITORY } from '../src/analytics/interfaces/profile-repository.token.js';
import { STATE_REPOSITORY } from '../src/analytics/interfaces/state-repository.token.js';
import { RULE_REPOSITORY } from '../src/analytics/rules/rule-repository.token.js';
import { AppModule } from '../src/app.module.js';
import { EVENT_LOG } from '../src/common/interfaces/event-log.token.js';
import { CANDLE_REPOSITORY } from '../src/market/interfaces/candle-repository.token.js';
import { WATCHLIST_REPOSITORY } from '../src/market/interfaces/watchlist-repository.token.js';

const SYMBOL_ID = 'crypto:BTCUSDT';
const PROFILE_ID = 'profile-e2e-backtest';
const STRATEGY_ID = 'strategy-e2e-backtest';
const MINUTE = 60_000;
const HOUR = 3_600_000;
/** A fixed past start so the window sits comfortably before now. */
const START = 1_600_000_000_000;
/** Enough 1m candles that a run stays in-flight while a sibling request fires. */
const MINUTE_BARS = 600;
const END = START + MINUTE_BARS * MINUTE;

/** A crypto candle at `time` with a flat OHLC at `close`. */
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

/** The strategy keyed to the state change the profile's rule sets. */
const strategy: BacktestStrategy = {
  id: STRATEGY_ID,
  name: 'E2E Breakout',
  description: '',
  entry: { signal: { key: 'signal', value: { type: StateValueType.Bool, value: true } } },
  exit: { signal: { key: 'signal', value: { type: StateValueType.Bool, value: false } } },
  createdAt: 1,
  updatedAt: 1,
};

/** An enabled, all-scope profile. */
const profile: Profile = {
  id: PROFILE_ID,
  name: 'E2E Momentum',
  description: '',
  enabled: true,
  scope: { type: ProfileScope.All },
  indicators: [],
  createdAt: 1,
  updatedAt: 1,
};

/** An `EveryTime` `Price > 100` rule setting `signal = true` — fires on each fed candle. */
const rule: Rule = {
  id: 'rule-e2e-backtest',
  profileId: PROFILE_ID,
  name: 'price marker',
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
      key: 'signal',
      value: { type: StateValueType.Bool, value: true },
    },
  ],
  enabled: true,
  order: 1,
  createdAt: 1,
  updatedAt: 1,
};

/** The `POST /backtests` body a run is started with. */
const body = () => ({
  strategyId: STRATEGY_ID,
  symbolId: SYMBOL_ID,
  profileId: PROFILE_ID,
  period: Period.OneHour,
  start: START,
  end: END,
  initialCapital: 10_000,
  commission: { rate: 0.1 },
});

/**
 * E2E for the backtest resource + isolated replay from the API consumer's
 * perspective: the real Nest app over a real Mongo (Testcontainers). Seeds a
 * watched symbol with candles across two periods and a profile whose rule sets a
 * state key, creates a strategy keyed to that change, runs a backtest over HTTP,
 * waits for completion, and asserts the persisted resource + its windowed events
 * — plus the two failure modes (a second start → 409, and a mid-run delete that
 * discards the run without persisting anything).
 */
describe('backtests API (e2e)', () => {
  let app: INestApplication;
  let backtestModel: Model<BacktestDoc>;
  let eventModel: Model<BacktestEventDoc>;
  let state: StateRepository;
  let eventLog: EventLog;

  /** Poll `GET /backtests/:id` until it reports `Completed`. */
  async function waitForCompleted(id: string): Promise<void> {
    for (let i = 0; i < 600; i++) {
      const res = await request(app.getHttpServer()).get(`/backtests/${id}`);
      if (res.body.status === 'completed') return;
      await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error('backtest never completed');
  }

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
      periods: [Period.OneMinute, Period.OneHour],
    });
    const candles = app.get<CandleRepository>(CANDLE_REPOSITORY);
    await candles.save(
      SYMBOL_ID,
      Period.OneMinute,
      Array.from({ length: MINUTE_BARS }, (_, i) => candle(START + i * MINUTE, 150)),
    );
    await candles.save(
      SYMBOL_ID,
      Period.OneHour,
      Array.from({ length: MINUTE_BARS / 60 }, (_, i) => candle(START + i * HOUR, 150)),
    );
    await app.get<ProfileRepository>(PROFILE_REPOSITORY).save(profile);
    await app.get<RuleRepository>(RULE_REPOSITORY).save(rule);
    await app.get<BacktestStrategyRepository>(BACKTEST_STRATEGY_REPOSITORY).save(strategy);

    backtestModel = app.get<Model<BacktestDoc>>(getModelToken(BacktestDoc.name));
    eventModel = app.get<Model<BacktestEventDoc>>(getModelToken(BacktestEventDoc.name));
    state = app.get<StateRepository>(STATE_REPOSITORY);
    eventLog = app.get<EventLog>(EVENT_LOG);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await backtestModel.deleteMany({});
    await eventModel.deleteMany({});
  });

  it('runs a backtest to completion, persisting the resource and its windowed events', async () => {
    const server = app.getHttpServer();
    const started = await request(server).post('/backtests').send(body());
    const id = started.body.id;
    await waitForCompleted(id);

    const got = await request(server).get(`/backtests/${id}`);
    const events = await request(server).get(`/backtests/${id}/events`);
    const liveSymbolState = await state.listSymbolState(PROFILE_ID, SYMBOL_ID);
    const liveEvents = await eventLog.symbolEvents(SYMBOL_ID);

    expect({
      startStatus: started.status,
      startState: started.body.status,
      completedStatus: got.body.status,
      symbolId: got.body.params.symbolId,
      profileName: got.body.params.profileName,
      strategyId: got.body.strategyId,
      strategyName: got.body.strategy.name,
      trades: got.body.trades,
      tradeCount: got.body.summary.tradeCount,
      eventsStatus: events.status,
      hasStateSetEvent: (events.body as RuleEventEntry[]).some((e) => e.type === 'stateSet'),
      liveSymbolState,
      liveEvents,
    }).toEqual({
      startStatus: 202,
      startState: 'running',
      completedStatus: 'completed',
      symbolId: SYMBOL_ID,
      profileName: 'E2E Momentum',
      strategyId: STRATEGY_ID,
      strategyName: 'E2E Breakout',
      trades: [],
      tradeCount: 0,
      eventsStatus: 200,
      hasStateSetEvent: true,
      liveSymbolState: {},
      liveEvents: [],
    });
  });

  it('rejects a second run while one is active with 409, then the active run cancels', async () => {
    const server = app.getHttpServer();
    const started = await request(server).post('/backtests').send(body());
    const again = await request(server).post('/backtests').send(body());
    const cancel = await request(server).delete(`/backtests/${started.body.id}`);
    expect({
      startStatus: started.status,
      againStatus: again.status,
      cancelStatus: cancel.status,
    }).toEqual({
      startStatus: 202,
      againStatus: 409,
      cancelStatus: 204,
    });
  });

  it('cancels a mid-run backtest and persists nothing', async () => {
    const server = app.getHttpServer();
    const started = await request(server).post('/backtests').send(body());
    const del = await request(server).delete(`/backtests/${started.body.id}`);
    const list = await request(server).get('/backtests');
    const persisted = await backtestModel.countDocuments({}).exec();
    expect({
      delStatus: del.status,
      list: list.body,
      persisted,
    }).toEqual({ delStatus: 204, list: [], persisted: 0 });
  });
});
