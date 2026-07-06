import {
  type Backtest,
  BacktestExitReason,
  type BacktestFrame,
  BacktestFrameKind,
  type BacktestProgress,
  BacktestStatus,
  type BacktestStrategy,
  type BacktestSummary,
  BacktestThresholdKind,
  type BacktestTrade,
  type Candle,
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
import { InMemoryCandleRepository } from '../../market/persistence/in-memory-candle.repository.js';
import { InMemoryWatchlistRepository } from '../../market/persistence/in-memory-watchlist.repository.js';
import { InMemoryProfileRepository } from '../persistence/in-memory-profile.repository.js';
import { BacktestService } from './backtest.service.js';
import { emptyBacktestSummary } from './backtest-executor.js';
import type {
  BacktestReplayHooks,
  BacktestReplayPort,
  BacktestReplayResult,
  BacktestReplayStep,
} from './backtest-replay.service.js';
import { InMemoryBacktestRepository } from './in-memory-backtest.repository.js';
import { InMemoryBacktestEventRepository } from './in-memory-backtest-event.repository.js';
import { InMemoryBacktestStrategyRepository } from './in-memory-backtest-strategy.repository.js';

/** A wall clock fixed after the run window's end (constant, so no time-based flush fires). */
const NOW = 1_700_200_000_000;
/** The run window (exactly one day). */
const START = 1_700_000_000_000;
const END = 1_700_086_400_000;
/** Milliseconds in a calendar day. */
const DAY_MS = 86_400_000;

/**
 * A replay fake that emits a scripted list of {@link BacktestReplayStep}s through
 * `onStep` (yielding a microtask between each so a mid-run subscriber can
 * observe), then either returns `result` or hangs forever.
 */
class SteppingReplay implements BacktestReplayPort {
  /**
   * @param steps - the steps to emit, one per fed candle.
   * @param result - the completed outcome to return after the last step.
   * @param hang - when `true`, never resolves (the run stays in flight).
   */
  constructor(
    private readonly steps: BacktestReplayStep[],
    private readonly result: BacktestReplayResult,
    private readonly hang = false,
  ) {}

  async replay(
    _params: unknown,
    _strategy: unknown,
    _profile: unknown,
    _periods: unknown,
    hooks?: BacktestReplayHooks,
  ): Promise<BacktestReplayResult> {
    for (const step of this.steps) {
      if (hooks?.isCancelled?.()) {
        return { events: [], trades: [], summary: emptyBacktestSummary(), cancelled: true };
      }
      hooks?.onStep?.(step);
      hooks?.onProgress?.(step.progress);
      await Promise.resolve();
    }
    if (this.hang) {
      return new Promise<BacktestReplayResult>(() => {});
    }
    hooks?.onProgress?.({ elapsedDays: (END - START) / DAY_MS, totalDays: (END - START) / DAY_MS });
    return this.result;
  }
}

/** A complete strategy snapshot. */
const strategy: BacktestStrategy = {
  id: 'strat-1',
  name: 'Breakout',
  description: '',
  entry: { signal: { key: 'trend', value: { type: StateValueType.String, value: 'up' } } },
  exit: { profitTarget: { kind: BacktestThresholdKind.Percentage, amount: 5 } },
  createdAt: 1,
  updatedAt: 1,
};

/** An enabled, all-scope profile. */
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

/** A watched symbol with two active periods. */
const watched: WatchedSymbol = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'Bitcoin',
  exchange: 'Binance',
  periods: [Period.OneHour, Period.OneMinute],
};

/** A crypto candle at `time` with a flat OHLC at `close`. */
const candle = (time: number, close = 100): Candle => ({
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

/** A `StateSet` run event tagged at `ts`. */
const stateEvent = (ts: number): RuleEventEntry => ({
  type: RuleEventType.StateSet,
  ts,
  firedAt: ts,
  ruleId: 'rule-1',
  symbolId: 'crypto:BTCUSDT',
  scope: StateScope.Symbol,
  key: 'trend',
  value: { type: StateValueType.String, value: 'up' },
});

/** A closed trade whose exact fields are asserted in the frame payloads. */
const trade = (entryTs: number, exitTs: number): BacktestTrade => ({
  entryTs,
  exitTs,
  entryPrice: 100,
  exitPrice: 105,
  quantity: 1,
  commission: 0,
  pnl: 5,
  roiPct: 5,
  exitReason: BacktestExitReason.ProfitTarget,
});

/** A running summary over `n` copies of the `trade` fixture. */
const summaryOf = (trades: BacktestTrade[]): BacktestSummary => {
  const tradeCount = trades.length;
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  return {
    totalPnl,
    roiPct: (totalPnl / 10_000) * 100,
    avgPnlPerTrade: tradeCount === 0 ? 0 : totalPnl / tradeCount,
    tradeCount,
    winners: trades.filter((t) => t.pnl > 0).length,
    losers: trades.filter((t) => t.pnl < 0).length,
    avgRoiPct: tradeCount === 0 ? 0 : trades.reduce((s, t) => s + t.roiPct, 0) / tradeCount,
    avgDaysInTrade:
      tradeCount === 0
        ? 0
        : trades.reduce((s, t) => s + (t.exitTs - t.entryTs) / DAY_MS, 0) / tradeCount,
  };
};

/** Progress at `elapsedMs` into the one-day window. */
const progressAt = (elapsedMs: number): BacktestProgress => ({
  elapsedDays: elapsedMs / DAY_MS,
  totalDays: (END - START) / DAY_MS,
});

/** A well-formed run request. */
const request = () => ({
  strategyId: 'strat-1',
  symbolId: 'crypto:BTCUSDT',
  profileId: 'prof-1',
  period: Period.OneHour,
  start: START,
  end: END,
  initialCapital: 10_000,
  commission: {},
});

/** Build a service over in-memory stores with a recording frame sink. */
function build(replay: BacktestReplayPort, options: { flushEveryCandles?: number } = {}) {
  const backtests = new InMemoryBacktestRepository([]);
  const events = new InMemoryBacktestEventRepository();
  const strategies = new InMemoryBacktestStrategyRepository([strategy]);
  const profiles = new InMemoryProfileRepository([profile]);
  const watchlist = new InMemoryWatchlistRepository([watched]);
  const candles = new InMemoryCandleRepository();
  const frames: Array<{ id: string; frame: BacktestFrame }> = [];
  const service = new BacktestService(
    backtests,
    events,
    strategies,
    profiles,
    watchlist,
    candles,
    replay,
    {
      newId: () => 'bt-1',
      now: () => NOW,
      onFrame: (id, frame) => frames.push({ id, frame }),
      flushEveryCandles: options.flushEveryCandles ?? 50,
    },
  );
  const ready = candles.save('crypto:BTCUSDT', Period.OneHour, [candle(START)]);
  return { service, backtests, events, frames, ready };
}

/** Poll `cond` across microtasks until true (hermetic — no fixed sleep). */
async function waitFor(cond: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await cond()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('condition was not met in time');
}

describe('BacktestService per-run stream snapshot', () => {
  it('reports no snapshot for a backtest id that is not the active run', async () => {
    const { service, ready } = build(new SteppingReplay([], emptyResult()));
    await ready;

    expect(service.activeSnapshotFrame('bt-1')).toBeNull();
  });

  it('exposes a snapshot reflecting everything the run has produced so far', async () => {
    const steps: BacktestReplayStep[] = [
      {
        candle: { period: Period.OneMinute, candle: candle(START, 100) },
        events: [stateEvent(START)],
        trades: [],
        summary: summaryOf([]),
        progress: progressAt(0),
      },
      {
        candle: { period: Period.OneHour, candle: candle(START + 60_000, 105) },
        events: [stateEvent(START + 60_000)],
        trades: [trade(START, START + 60_000)],
        summary: summaryOf([trade(START, START + 60_000)]),
        progress: progressAt(60_000),
      },
    ];
    const { service, ready } = build(new SteppingReplay(steps, emptyResult(), true));
    await ready;
    await service.start(request());
    await waitFor(() => (service.activeSnapshotFrame('bt-1')?.events.length ?? 0) === 2);

    expect(service.activeSnapshotFrame('bt-1')).toEqual({
      kind: BacktestFrameKind.Snapshot,
      status: BacktestStatus.Running,
      progress: progressAt(60_000),
      params: {
        symbolId: 'crypto:BTCUSDT',
        profileId: 'prof-1',
        profileName: 'Momentum',
        period: Period.OneHour,
        start: START,
        end: END,
        initialCapital: 10_000,
        commission: {},
      },
      trades: [trade(START, START + 60_000)],
      summary: summaryOf([trade(START, START + 60_000)]),
      events: [stateEvent(START), stateEvent(START + 60_000)],
    });
  });
});

describe('BacktestService per-run stream deltas', () => {
  it('batches deltas by candle count and ends with a Completed frame', async () => {
    const t1 = trade(START, START + 60_000);
    const steps: BacktestReplayStep[] = [
      {
        candle: { period: Period.OneMinute, candle: candle(START, 100) },
        events: [stateEvent(START)],
        trades: [],
        summary: summaryOf([]),
        progress: progressAt(0),
      },
      {
        candle: { period: Period.OneMinute, candle: candle(START + 60_000, 105) },
        events: [stateEvent(START + 60_000)],
        trades: [t1],
        summary: summaryOf([t1]),
        progress: progressAt(60_000),
      },
      {
        candle: { period: Period.OneHour, candle: candle(START + 120_000, 110) },
        events: [],
        trades: [],
        summary: summaryOf([t1]),
        progress: progressAt(120_000),
      },
    ];
    const result: BacktestReplayResult = {
      events: [stateEvent(START), stateEvent(START + 60_000)],
      trades: [t1],
      summary: summaryOf([t1]),
      cancelled: false,
    };
    const { service, frames, ready } = build(new SteppingReplay(steps, result), {
      flushEveryCandles: 2,
    });
    await ready;
    await service.start(request());
    await waitFor(async () => (await service.get('bt-1')).status === 'completed');

    expect(frames).toEqual([
      {
        id: 'bt-1',
        frame: {
          kind: BacktestFrameKind.Delta,
          status: BacktestStatus.Running,
          progress: progressAt(60_000),
          candles: [
            { period: Period.OneMinute, candle: candle(START, 100) },
            { period: Period.OneMinute, candle: candle(START + 60_000, 105) },
          ],
          events: [stateEvent(START), stateEvent(START + 60_000)],
          trades: [t1],
          summary: summaryOf([t1]),
        },
      },
      {
        id: 'bt-1',
        frame: {
          kind: BacktestFrameKind.Delta,
          status: BacktestStatus.Completed,
          progress: progressAt(END - START),
          candles: [{ period: Period.OneHour, candle: candle(START + 120_000, 110) }],
          events: [],
          trades: [],
          summary: summaryOf([t1]),
        },
      },
    ]);
  });

  it('has already persisted the completed backtest by the time the final frame is sent', async () => {
    const t1 = trade(START, START + 60_000);
    const steps: BacktestReplayStep[] = [
      {
        candle: { period: Period.OneMinute, candle: candle(START, 100) },
        events: [stateEvent(START)],
        trades: [t1],
        summary: summaryOf([t1]),
        progress: progressAt(60_000),
      },
    ];
    const result: BacktestReplayResult = {
      events: [stateEvent(START)],
      trades: [t1],
      summary: summaryOf([t1]),
      cancelled: false,
    };
    const backtests = new InMemoryBacktestRepository([]);
    // The final frame fires only after `save`, so a store read captured at that
    // instant must already resolve the persisted, completed backtest.
    const readsAtFinalFrame: Array<Promise<Backtest | null>> = [];
    const service = new BacktestService(
      backtests,
      new InMemoryBacktestEventRepository(),
      new InMemoryBacktestStrategyRepository([strategy]),
      new InMemoryProfileRepository([profile]),
      new InMemoryWatchlistRepository([watched]),
      await candleStore(),
      new SteppingReplay(steps, result),
      {
        newId: () => 'bt-1',
        now: () => NOW,
        onFrame: (_id, frame) => {
          if (frame.kind === BacktestFrameKind.Delta && frame.status === BacktestStatus.Completed) {
            readsAtFinalFrame.push(backtests.get('bt-1'));
          }
        },
      },
    );
    await service.start(request());
    await waitFor(() => readsAtFinalFrame.length > 0);

    const [read] = readsAtFinalFrame;
    const persisted = read === undefined ? null : await read;
    expect({ status: persisted?.status, trades: persisted?.trades }).toEqual({
      status: 'completed',
      trades: [t1],
    });
  });
});

/** The empty replay outcome (no trades, no events). */
function emptyResult(): BacktestReplayResult {
  return { events: [], trades: [], summary: emptyBacktestSummary(), cancelled: false };
}

/** A candle store seeded with one in-range candle so run validation passes. */
async function candleStore(): Promise<InMemoryCandleRepository> {
  const candles = new InMemoryCandleRepository();
  await candles.save('crypto:BTCUSDT', Period.OneHour, [candle(START)]);
  return candles;
}
