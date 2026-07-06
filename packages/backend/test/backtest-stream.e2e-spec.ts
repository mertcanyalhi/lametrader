import {
  ActionKind,
  type BacktestFrame,
  type BacktestStrategy,
  type BacktestStrategyRepository,
  BacktestThresholdKind,
  type Candle,
  type CandleRepository,
  ComparisonOperator,
  ConditionNodeKind,
  LeafConditionFamily,
  OperandKind,
  Period,
  type Profile,
  type ProfileRepository,
  ProfileScope,
  type Rule,
  type RuleRepository,
  RuleScopeKind,
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
import { WebSocket } from 'ws';
import { BacktestDoc } from '../src/analytics/backtesting/backtest.schema.js';
import { BacktestEventDoc } from '../src/analytics/backtesting/backtest-event.schema.js';
import { BACKTEST_STRATEGY_REPOSITORY } from '../src/analytics/backtesting/backtest-strategy-repository.token.js';
import { PROFILE_REPOSITORY } from '../src/analytics/interfaces/profile-repository.token.js';
import { RULE_REPOSITORY } from '../src/analytics/rules/rule-repository.token.js';
import { AppModule } from '../src/app.module.js';
import { CANDLE_REPOSITORY } from '../src/market/interfaces/candle-repository.token.js';
import { WATCHLIST_REPOSITORY } from '../src/market/interfaces/watchlist-repository.token.js';

const SYMBOL_ID = 'crypto:BTCUSDT';
const PROFILE_ID = 'profile-e2e-stream';
const STRATEGY_ID = 'strategy-e2e-stream';
const MINUTE = 60_000;
const HOUR = 3_600_000;
/** A fixed past start so the window sits comfortably before now. */
const START = 1_600_000_000_000;
/** Enough 1m candles that the run stays in-flight while a socket subscribes. */
const MINUTE_BARS = 600;
const END = START + MINUTE_BARS * MINUTE;
/** The half-way boundary where the price steps from 100 to 200. */
const MID_MINUTE = MINUTE_BARS / 2;
const MID = START + MID_MINUTE * MINUTE;
/** The pre-step price and post-step price. */
const LOW_PRICE = 100;
const HIGH_PRICE = 200;

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

/** Enter when the rule's `signal` becomes true, exit at a +50 % profit target. */
const strategy: BacktestStrategy = {
  id: STRATEGY_ID,
  name: 'E2E Stream Breakout',
  description: '',
  entry: { signal: { key: 'signal', value: { type: StateValueType.Bool, value: true } } },
  exit: { profitTarget: { kind: BacktestThresholdKind.Percentage, amount: 50 } },
  createdAt: 1,
  updatedAt: 1,
};

/** An enabled, all-scope profile. */
const profile: Profile = {
  id: PROFILE_ID,
  name: 'E2E Stream Momentum',
  description: '',
  enabled: true,
  scope: { type: ProfileScope.All },
  indicators: [],
  createdAt: 1,
  updatedAt: 1,
};

/** An `EveryTime` `Price > 50` rule setting `signal = true` — fires on each fed candle. */
const rule: Rule = {
  id: 'rule-e2e-stream',
  profileId: PROFILE_ID,
  name: 'price marker',
  scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
  condition: {
    kind: ConditionNodeKind.Leaf,
    leaf: {
      family: LeafConditionFamily.Comparison,
      operator: ComparisonOperator.Gt,
      left: { kind: OperandKind.Price },
      right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 50 } },
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
  commission: {},
});

/** A frame frame or an error envelope pushed over the socket. */
type Inbound = BacktestFrame | { error: string };

/**
 * A thin socket client that queues inbound frames, resolves when a predicate
 * matches (or the socket closes), and reports whether the server closed it.
 */
interface StreamClient {
  /** Every frame received, in order. */
  readonly frames: Inbound[];
  /** Resolve once `predicate` holds over the received frames, else on close. */
  until(predicate: (frames: Inbound[]) => boolean): Promise<void>;
  /** Resolve once the server closes the socket. */
  closed(): Promise<void>;
}

/**
 * E2E for the per-run backtest stream WebSocket from the client's perspective:
 * the real Nest app over a real Mongo (Testcontainers), driving a run over the
 * socket end to end and asserting the snapshot-then-deltas protocol, the
 * reattach snapshot, and the unknown-id error close.
 */
describe('backtest stream WebSocket (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let backtestModel: Model<BacktestDoc>;
  let eventModel: Model<BacktestEventDoc>;
  const openSockets: WebSocket[] = [];

  /** Open a `/backtests/:id/stream` socket and wrap it as a {@link StreamClient}. */
  async function connect(id: string): Promise<StreamClient> {
    const socket = new WebSocket(`${baseUrl.replace('http', 'ws')}/backtests/${id}/stream`);
    openSockets.push(socket);
    const frames: Inbound[] = [];
    let isClosed = false;
    const waiters: Array<() => void> = [];
    const notify = () => {
      for (const w of waiters.splice(0)) w();
    };
    socket.on('message', (data) => {
      frames.push(JSON.parse(String(data)) as Inbound);
      notify();
    });
    socket.on('close', () => {
      isClosed = true;
      notify();
    });
    await new Promise<void>((resolve, reject) => {
      socket.on('open', () => resolve());
      socket.on('error', () => reject(new Error('ws failed to open')));
    });
    const settle = (predicate: (f: Inbound[]) => boolean): Promise<void> =>
      new Promise((resolve) => {
        const check = () => {
          if (predicate(frames) || isClosed) resolve();
          else waiters.push(check);
        };
        check();
      });
    return {
      frames,
      until: (predicate) => settle(predicate),
      closed: () => settle(() => false),
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();

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
      Array.from({ length: MINUTE_BARS }, (_, i) =>
        candle(START + i * MINUTE, i < MID_MINUTE ? LOW_PRICE : HIGH_PRICE),
      ),
    );
    await candles.save(
      SYMBOL_ID,
      Period.OneHour,
      Array.from({ length: MINUTE_BARS / 60 }, (_, i) =>
        candle(START + i * HOUR, START + i * HOUR < MID ? LOW_PRICE : HIGH_PRICE),
      ),
    );
    await app.get<ProfileRepository>(PROFILE_REPOSITORY).save(profile);
    await app.get<RuleRepository>(RULE_REPOSITORY).save(rule);
    await app.get<BacktestStrategyRepository>(BACKTEST_STRATEGY_REPOSITORY).save(strategy);

    backtestModel = app.get<Model<BacktestDoc>>(getModelToken(BacktestDoc.name));
    eventModel = app.get<Model<BacktestEventDoc>>(getModelToken(BacktestEventDoc.name));
  }, 120_000);

  afterAll(async () => {
    for (const socket of openSockets) socket.close();
    await app?.close();
  });

  beforeEach(async () => {
    await backtestModel.deleteMany({});
    await eventModel.deleteMany({});
  });

  it('streams a run snapshot-first then batched deltas ending in a Completed frame, then serves the persisted result', async () => {
    const server = app.getHttpServer();
    const started = await request(server).post('/backtests').send(body());
    const id = started.body.id as string;

    const client = await connect(id);
    await client.until((frames) =>
      frames.some((f) => 'kind' in f && f.kind === 'delta' && f.status === 'completed'),
    );

    const got = await request(server).get(`/backtests/${id}`);
    const first = client.frames[0];
    const deltas = client.frames.filter(
      (f): f is Extract<BacktestFrame, { kind: 'delta' }> => 'kind' in f && f.kind === 'delta',
    );
    const last = client.frames[client.frames.length - 1];

    expect({
      firstKind: first && 'kind' in first ? first.kind : null,
      firstStatus: first && 'kind' in first ? first.status : null,
      snapshotHasNoCandles: first !== undefined && 'kind' in first && !('candles' in first),
      someDeltaHasCandles: deltas.some((d) => d.candles.length > 0),
      lastKind: last && 'kind' in last ? last.kind : null,
      lastStatus: last && 'kind' in last ? last.status : null,
      completedStatus: got.body.status,
      completedTradeCount: got.body.summary.tradeCount,
      hasClosedTrade: Array.isArray(got.body.trades) && got.body.trades.length === 1,
    }).toEqual({
      firstKind: 'snapshot',
      firstStatus: 'running',
      snapshotHasNoCandles: true,
      someDeltaHasCandles: true,
      lastKind: 'delta',
      lastStatus: 'completed',
      completedStatus: 'completed',
      completedTradeCount: 1,
      hasClosedTrade: true,
    });
  }, 30_000);

  it('delivers a completed snapshot to a reattaching client and then closes the socket', async () => {
    const server = app.getHttpServer();
    const started = await request(server).post('/backtests').send(body());
    const id = started.body.id as string;
    const live = await connect(id);
    await live.until((frames) =>
      frames.some((f) => 'kind' in f && f.kind === 'delta' && f.status === 'completed'),
    );

    const reattached = await connect(id);
    await reattached.closed();
    const snapshot = reattached.frames[0];

    expect({
      frameCount: reattached.frames.length,
      kind: snapshot && 'kind' in snapshot ? snapshot.kind : null,
      status: snapshot && 'kind' in snapshot ? snapshot.status : null,
      tradeCount:
        snapshot && 'kind' in snapshot && snapshot.kind === 'snapshot'
          ? snapshot.trades.length
          : null,
    }).toEqual({ frameCount: 1, kind: 'snapshot', status: 'completed', tradeCount: 1 });
  }, 30_000);

  it('closes with an error frame when subscribing to an unknown run id', async () => {
    const client = await connect('no-such-backtest');
    await client.closed();
    const frame = client.frames[0];

    expect({
      frameCount: client.frames.length,
      error: frame !== undefined && 'error' in frame ? frame.error : null,
    }).toEqual({ frameCount: 1, error: 'backtest not found: no-such-backtest' });
  }, 30_000);
});
