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

/**
 * A replay fake that emits `before` steps synchronously, then awaits a
 * test-controlled `gate` (so the test can observe the run paused with items
 * pending), then emits `after` steps and returns `result`. Lets a mid-run
 * reattach be simulated at an exact, deterministic point.
 */
class GatedReplay implements BacktestReplayPort {
  /**
   * @param before - steps emitted before the gate opens.
   * @param gate - resolves to release the `after` steps.
   * @param after - steps emitted once the gate opens.
   * @param result - the completed outcome returned after the last step.
   */
  constructor(
    private readonly before: BacktestReplayStep[],
    private readonly gate: Promise<void>,
    private readonly after: BacktestReplayStep[],
    private readonly result: BacktestReplayResult,
  ) {}

  async replay(
    _params: unknown,
    _strategy: unknown,
    _profile: unknown,
    _periods: unknown,
    hooks?: BacktestReplayHooks,
  ): Promise<BacktestReplayResult> {
    for (const step of this.before) {
      hooks?.onStep?.(step);
      hooks?.onProgress?.(step.progress);
    }
    await this.gate;
    for (const step of this.after) {
      hooks?.onStep?.(step);
      hooks?.onProgress?.(step.progress);
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

  it('exposes a snapshot reflecting the run state flushed into deltas so far', async () => {
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
    // Flush after both candles so the snapshot's flushed prefix holds them.
    const { service, ready } = build(new SteppingReplay(steps, emptyResult(), true), {
      flushEveryCandles: 2,
    });
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
          // Every processed candle streams now, tagged with its period — here two
          // 1m candles finer than the 1h run period. The client folds finer
          // candles into the forming run-period bar so it advances intra-bar.
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

describe('BacktestService per-run stream exactly-once on reattach', () => {
  it('delivers each trade and event exactly once across a mid-run subscriber snapshot and the deltas that follow it', async () => {
    // Distinct trades/events so a duplicate is visible in the full-payload union.
    const tA = trade(START, START + 60_000);
    const tB = trade(START + 60_000, START + 120_000);
    const tC = trade(START + 120_000, START + 180_000);
    const eA = stateEvent(START);
    const eB = stateEvent(START + 60_000);
    const eC = stateEvent(START + 120_000);
    const eD = stateEvent(START + 180_000);
    // `before`: steps 1-2 flush (count 2), step 3 leaves eC + tB pending; the
    // reattaching subscriber must NOT see the pending items in its snapshot but
    // MUST receive them once in the delta that flushes them.
    const before: BacktestReplayStep[] = [
      {
        candle: { period: Period.OneHour, candle: candle(START, 100) },
        events: [eA],
        trades: [],
        summary: summaryOf([]),
        progress: progressAt(0),
      },
      {
        candle: { period: Period.OneHour, candle: candle(START + 3_600_000, 105) },
        events: [eB],
        trades: [tA],
        summary: summaryOf([tA]),
        progress: progressAt(3_600_000),
      },
      {
        candle: { period: Period.OneHour, candle: candle(START + 7_200_000, 110) },
        events: [eC],
        trades: [tB],
        summary: summaryOf([tA, tB]),
        progress: progressAt(7_200_000),
      },
    ];
    const after: BacktestReplayStep[] = [
      {
        candle: { period: Period.OneHour, candle: candle(START + 10_800_000, 115) },
        events: [eD],
        trades: [tC],
        summary: summaryOf([tA, tB, tC]),
        progress: progressAt(10_800_000),
      },
    ];
    const result: BacktestReplayResult = {
      events: [eA, eB, eC, eD],
      trades: [tA, tB, tC],
      summary: summaryOf([tA, tB, tC]),
      cancelled: false,
    };
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const { service, frames, ready } = build(new GatedReplay(before, gate, after, result), {
      flushEveryCandles: 2,
    });
    await ready;
    // `start` kicks the replay off; the synchronous `before` steps run before it
    // returns, so the run is now paused at the gate with eC + tB pending.
    await service.start(request());

    // Reattach: capture the snapshot and the count of deltas already emitted (the
    // ones a late subscriber would never receive).
    const snapshot = service.activeSnapshotFrame('bt-1');
    const deltasBeforeReattach = frames.length;

    openGate();
    await waitFor(async () => (await service.get('bt-1')).status === 'completed');
    const laterDeltas = frames
      .slice(deltasBeforeReattach)
      .map((f) => f.frame)
      .filter((f): f is Extract<BacktestFrame, { kind: 'delta' }> => f.kind === 'delta');

    expect({
      trades: [...(snapshot?.trades ?? []), ...laterDeltas.flatMap((d) => d.trades)],
      events: [...(snapshot?.events ?? []), ...laterDeltas.flatMap((d) => d.events)],
    }).toEqual({
      trades: [tA, tB, tC],
      events: [eA, eB, eC, eD],
    });
  });
});

describe('BacktestService per-run stream candle scope', () => {
  it('carries every active period candle in deltas, tagged with its period', async () => {
    const runPeriodOne = candle(START, 200);
    const runPeriodTwo = candle(START + 3_600_000, 210);
    // Interleave finer-period (1m) candles with the run-period (1h) ones; every
    // processed candle streams, period-tagged, so the client can fold the finer
    // ones into the forming run-period bar.
    const steps: BacktestReplayStep[] = [
      {
        candle: { period: Period.OneMinute, candle: candle(START, 100) },
        events: [],
        trades: [],
        summary: summaryOf([]),
        progress: progressAt(0),
      },
      {
        candle: { period: Period.OneHour, candle: runPeriodOne },
        events: [],
        trades: [],
        summary: summaryOf([]),
        progress: progressAt(3_600_000),
      },
      {
        candle: { period: Period.OneMinute, candle: candle(START + 60_000, 110) },
        events: [],
        trades: [],
        summary: summaryOf([]),
        progress: progressAt(60_000),
      },
      {
        candle: { period: Period.OneHour, candle: runPeriodTwo },
        events: [],
        trades: [],
        summary: summaryOf([]),
        progress: progressAt(7_200_000),
      },
    ];
    const { service, frames, ready } = build(new SteppingReplay(steps, emptyResult()), {
      flushEveryCandles: 2,
    });
    await ready;
    await service.start(request());
    await waitFor(async () => (await service.get('bt-1')).status === 'completed');

    const streamedCandles = frames
      .map((f) => f.frame)
      .filter((f): f is Extract<BacktestFrame, { kind: 'delta' }> => f.kind === 'delta')
      .flatMap((d) => d.candles);
    expect(streamedCandles).toEqual([
      { period: Period.OneMinute, candle: candle(START, 100) },
      { period: Period.OneHour, candle: runPeriodOne },
      { period: Period.OneMinute, candle: candle(START + 60_000, 110) },
      { period: Period.OneHour, candle: runPeriodTwo },
    ]);
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
