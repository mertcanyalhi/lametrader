import {
  type BacktestParams,
  Period,
  type Profile,
  ProfileScope,
  type RuleEventEntry,
  RuleEventType,
  StateScope,
  StateValueType,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DomainExceptionFilter } from '../../common/domain-exception.filter.js';
import { buildValidationPipe } from '../../common/validation.pipe.js';
import { InMemoryCandleRepository } from '../../market/persistence/in-memory-candle.repository.js';
import { InMemoryWatchlistRepository } from '../../market/persistence/in-memory-watchlist.repository.js';
import { InMemoryProfileRepository } from '../persistence/in-memory-profile.repository.js';
import { BacktestService } from './backtest.service.js';
import type {
  BacktestReplayHooks,
  BacktestReplayPort,
  BacktestReplayResult,
} from './backtest-replay.service.js';
import { BacktestsController } from './backtests.controller.js';
import { InMemoryBacktestRepository } from './in-memory-backtest.repository.js';
import { InMemoryBacktestEventRepository } from './in-memory-backtest-event.repository.js';
import { InMemoryBacktestStrategyRepository } from './in-memory-backtest-strategy.repository.js';

const START = 1_700_000_000_000;
const END = 1_700_086_400_000;
const NOW = 1_700_200_000_000;

/** A replay fake: completes immediately with `events`, or hangs when `hang`. */
class FakeReplay implements BacktestReplayPort {
  constructor(
    private readonly hang: boolean,
    private readonly events: RuleEventEntry[] = [],
  ) {}
  async replay(
    _params: BacktestParams,
    _profile: Profile,
    _periods: Period[],
    _hooks?: BacktestReplayHooks,
  ): Promise<BacktestReplayResult> {
    if (this.hang) return new Promise<BacktestReplayResult>(() => {});
    return { events: this.events, cancelled: false };
  }
}

const strategy = {
  id: 'strat-1',
  name: 'Breakout',
  description: '',
  entry: { signal: { key: 'trend', value: { type: StateValueType.String, value: 'up' } } },
  exit: { profitTarget: { kind: 'percentage', amount: 5 } },
  createdAt: 1,
  updatedAt: 1,
} as const;

const profile: Profile = {
  id: 'prof-1',
  name: 'Momentum',
  description: '',
  enabled: true,
  scope: { type: ProfileScope.All },
  indicators: [],
  createdAt: 1,
  updatedAt: 1,
};

const symbol: WatchedSymbol = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  name: 'Bitcoin',
  exchange: 'Binance',
  periods: [Period.OneHour],
};

const runEvent: RuleEventEntry = {
  type: RuleEventType.StateSet,
  ts: START,
  firedAt: START,
  ruleId: 'rule-1',
  symbolId: 'crypto:BTCUSDT',
  scope: StateScope.Symbol,
  key: 'trend',
  value: { type: StateValueType.String, value: 'up' },
};

const body = (overrides: Record<string, unknown> = {}) => ({
  strategyId: 'strat-1',
  symbolId: 'crypto:BTCUSDT',
  profileId: 'prof-1',
  period: '1h',
  start: START,
  end: END,
  initialCapital: 10_000,
  commission: { rate: 0.1, fixed: 1 },
  ...overrides,
});

/**
 * Local (Docker-free) integration proof of the `/backtests` HTTP contract: the
 * {@link BacktestsController} behind the real global validation pipe and
 * exception filter, over in-memory stores and a controllable replay fake. Pins
 * routes, verbs, status codes, and payload shapes so the container-backed e2e
 * tier only has to prove the Mongo wiring and the real engine replay.
 */
describe('backtests HTTP contract (integration)', () => {
  let app: INestApplication;

  async function buildApp(replay: BacktestReplayPort): Promise<INestApplication> {
    const candles = new InMemoryCandleRepository();
    await candles.save('crypto:BTCUSDT', Period.OneHour, [
      {
        type: SymbolType.Crypto,
        time: START,
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 1,
        quoteVolume: 100,
        trades: 1,
      },
    ]);
    const service = new BacktestService(
      new InMemoryBacktestRepository(),
      new InMemoryBacktestEventRepository(),
      new InMemoryBacktestStrategyRepository([{ ...strategy }]),
      new InMemoryProfileRepository([profile]),
      new InMemoryWatchlistRepository([symbol]),
      candles,
      replay,
      { newId: () => 'bt-1', now: () => NOW },
    );
    const moduleRef = await Test.createTestingModule({
      controllers: [BacktestsController],
      providers: [{ provide: BacktestService, useValue: service }],
    }).compile();
    const nestApp = moduleRef.createNestApplication();
    nestApp.useGlobalPipes(buildValidationPipe());
    nestApp.useGlobalFilters(new DomainExceptionFilter());
    await nestApp.init();
    return nestApp;
  }

  /** Poll `GET /backtests/:id` until it reports `Completed`. */
  async function waitForCompleted(id: string): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const res = await request(app.getHttpServer()).get(`/backtests/${id}`);
      if (res.body.status === 'completed') return;
      await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error('backtest never completed');
  }

  afterEach(async () => {
    await app?.close();
  });

  it('POST /backtests starts a run and returns 202 with the running backtest', async () => {
    app = await buildApp(new FakeReplay(true));
    const res = await request(app.getHttpServer()).post('/backtests').send(body());
    expect({
      status: res.status,
      id: res.body.id,
      s: res.body.status,
      progress: res.body.progress,
    }).toEqual({
      status: 202,
      id: 'bt-1',
      s: 'running',
      progress: { elapsedDays: 0, totalDays: 1 },
    });
  });

  it('POST /backtests returns 409 while another run is active', async () => {
    app = await buildApp(new FakeReplay(true));
    await request(app.getHttpServer()).post('/backtests').send(body());
    const res = await request(app.getHttpServer()).post('/backtests').send(body());
    expect({ status: res.status, body: res.body }).toEqual({
      status: 409,
      body: { error: 'a backtest run is already active' },
    });
  });

  it('POST /backtests returns a domain 400 for start ≥ end', async () => {
    app = await buildApp(new FakeReplay(true));
    const res = await request(app.getHttpServer())
      .post('/backtests')
      .send(body({ start: END }));
    expect({ status: res.status, body: res.body }).toEqual({
      status: 400,
      body: { error: 'start must be before end' },
    });
  });

  it('POST /backtests returns 404 for an unknown strategy id', async () => {
    app = await buildApp(new FakeReplay(true));
    const res = await request(app.getHttpServer())
      .post('/backtests')
      .send(body({ strategyId: 'ghost' }));
    expect({ status: res.status, body: res.body }).toEqual({
      status: 404,
      body: { error: 'backtest strategy not found: ghost' },
    });
  });

  it('POST /backtests rejects a missing field with the validation envelope', async () => {
    app = await buildApp(new FakeReplay(true));
    const { symbolId, ...rest } = body();
    void symbolId;
    const res = await request(app.getHttpServer()).post('/backtests').send(rest);
    expect({
      status: res.status,
      error: res.body.error,
      paths: res.body.fields.map((f: { path: string }) => f.path),
    }).toEqual({ status: 400, error: 'Validation failed', paths: ['symbolId'] });
  });

  it('GET /backtests lists the running backtest', async () => {
    app = await buildApp(new FakeReplay(true));
    await request(app.getHttpServer()).post('/backtests').send(body());
    const res = await request(app.getHttpServer()).get('/backtests');
    expect({ status: res.status, ids: res.body.map((b: { id: string }) => b.id) }).toEqual({
      status: 200,
      ids: ['bt-1'],
    });
  });

  it('GET /backtests?status filters', async () => {
    app = await buildApp(new FakeReplay(true));
    await request(app.getHttpServer()).post('/backtests').send(body());
    const res = await request(app.getHttpServer()).get('/backtests?status=completed');
    expect({ status: res.status, body: res.body }).toEqual({ status: 200, body: [] });
  });

  it('GET /backtests/:id returns 404 for an unknown id', async () => {
    app = await buildApp(new FakeReplay(true));
    const res = await request(app.getHttpServer()).get('/backtests/ghost');
    expect({ status: res.status, body: res.body }).toEqual({
      status: 404,
      body: { error: 'backtest not found: ghost' },
    });
  });

  it('GET /backtests/:id/events returns 400 while the run is active', async () => {
    app = await buildApp(new FakeReplay(true));
    await request(app.getHttpServer()).post('/backtests').send(body());
    const res = await request(app.getHttpServer()).get('/backtests/bt-1/events');
    expect({ status: res.status, body: res.body }).toEqual({
      status: 400,
      body: { error: 'run events are not available while the backtest is running' },
    });
  });

  it('DELETE /backtests/:id cancels a running backtest and returns 204', async () => {
    app = await buildApp(new FakeReplay(true));
    await request(app.getHttpServer()).post('/backtests').send(body());
    const del = await request(app.getHttpServer()).delete('/backtests/bt-1');
    const after = await request(app.getHttpServer()).get('/backtests');
    expect({ delStatus: del.status, remaining: after.body }).toEqual({
      delStatus: 204,
      remaining: [],
    });
  });

  it('a completed run is renameable, its events are windowed, and it deletes with 204', async () => {
    app = await buildApp(new FakeReplay(false, [runEvent]));
    await request(app.getHttpServer()).post('/backtests').send(body());
    await waitForCompleted('bt-1');
    const renamed = await request(app.getHttpServer())
      .patch('/backtests/bt-1')
      .send({ name: 'Mine' });
    const events = await request(app.getHttpServer()).get('/backtests/bt-1/events');
    const del = await request(app.getHttpServer()).delete('/backtests/bt-1');
    expect({
      renameStatus: renamed.status,
      renamedName: renamed.body.name,
      eventsStatus: events.status,
      eventTypes: events.body.map((e: { type: string }) => e.type),
      deleteStatus: del.status,
    }).toEqual({
      renameStatus: 200,
      renamedName: 'Mine',
      eventsStatus: 200,
      eventTypes: ['stateSet'],
      deleteStatus: 204,
    });
  });

  it('PATCH /backtests/:id returns a domain 400 while the run is active', async () => {
    app = await buildApp(new FakeReplay(true));
    await request(app.getHttpServer()).post('/backtests').send(body());
    const res = await request(app.getHttpServer()).patch('/backtests/bt-1').send({ name: 'x' });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 400,
      body: { error: 'cannot rename a running backtest' },
    });
  });
});
