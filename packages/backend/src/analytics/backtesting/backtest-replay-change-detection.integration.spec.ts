import {
  ActionKind,
  type BacktestParams,
  type BacktestStrategy,
  BacktestThresholdKind,
  type Candle,
  ComparisonOperator,
  ConditionNodeKind,
  type IndicatorInstance,
  LeafConditionFamily,
  type Notifier,
  OperandKind,
  Period,
  type Profile,
  ProfileScope,
  type Rule,
  type RuleEventEntry,
  RuleScopeKind,
  StateValueType,
  SymbolType,
  TriggerKind,
  type WatchedSymbol,
} from '@lametrader/core';
import { InMemoryEventLog } from '../../common/persistence/in-memory-event-log.js';
import { InMemoryCandleRepository } from '../../market/persistence/in-memory-candle.repository.js';
import { InMemoryWatchlistRepository } from '../../market/persistence/in-memory-watchlist.repository.js';
import { defaultIndicators } from '../indicators/default-indicators.js';
import { IndicatorService } from '../indicators/indicator.service.js';
import { InMemoryProfileRepository } from '../persistence/in-memory-profile.repository.js';
import { InMemoryStateRepository } from '../persistence/in-memory-state.repository.js';
import { InMemoryOncePerBarLatchStore } from '../rules/dispatch/in-memory-once-per-bar-latch.store.js';
import { InMemoryRuleRepository } from '../rules/in-memory-rule.repository.js';
import { IndicatorSeriesStore } from '../rules/indicator-series-store.js';
import { registerIndicatorInstances } from '../rules/wire/register-indicator-instances.js';
import { feedCandleIntoEngine, wireRuleEngine } from '../rules/wire/wire-rule-engine.js';
import { BacktestExecutor } from './backtest-executor.js';
import {
  type BacktestReplayResult,
  BacktestReplayService,
  orderBacktestFeed,
} from './backtest-replay.service.js';

const SYMBOL_ID = 'crypto:BTCUSDT';
const MINUTE = 60_000;
const HOUR = 3_600_000;

/** The one SMA instance the coarse-period operand of every test reads. */
const SMA_INSTANCE_ID = 'sma-3-inst';
/** The SMA inputs — one shared operand identity across every observation. */
const SMA_INPUTS = { length: 3, source: 'close' } as const;

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

/** The SMA(3) attachment the replayed profile carries so its `IndicatorRef` resolves. */
const smaInstance: IndicatorInstance = {
  id: SMA_INSTANCE_ID,
  indicatorKey: 'sma',
  version: 1,
  inputs: { ...SMA_INPUTS },
};

/** An enabled, all-scope profile carrying the shared SMA instance. */
const profile: Profile = {
  id: 'prof-1',
  name: 'Momentum',
  description: '',
  enabled: true,
  scope: { type: ProfileScope.All },
  indicators: [smaInstance],
  createdAt: 1,
  updatedAt: 1,
};

/** A watched crypto symbol on the 1m + 1h periods. */
const watched: WatchedSymbol = {
  id: SYMBOL_ID,
  type: SymbolType.Crypto,
  description: 'Bitcoin',
  exchange: 'Binance',
  periods: [Period.OneMinute, Period.OneHour],
};

/** The run params for `[start, end)` anchored on the 1m period. */
const params = (start: number, end: number): BacktestParams => ({
  symbolId: SYMBOL_ID,
  profileId: 'prof-1',
  profileName: 'Momentum',
  period: Period.OneMinute,
  start,
  end,
  initialCapital: 10_000,
  commission: {},
});

/**
 * A per-tick rule whose condition compares the coarse SMA operand (computed on
 * the **1h** interval) against `threshold`, so every fine-bar observation reads
 * the coarse operand — the canonical #556 redundancy.
 */
const coarseIndicatorRule = (threshold: number, actions: Rule['actions']): Rule => ({
  id: 'r-coarse',
  profileId: 'prof-1',
  name: 'coarse sma gate',
  scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
  condition: {
    kind: ConditionNodeKind.Leaf,
    leaf: {
      family: LeafConditionFamily.Comparison,
      operator: ComparisonOperator.Gt,
      left: {
        kind: OperandKind.IndicatorRef,
        instanceId: SMA_INSTANCE_ID,
        stateKey: 'value',
        valueType: StateValueType.Number,
      },
      right: {
        kind: OperandKind.Literal,
        value: { type: StateValueType.Number, value: threshold },
      },
      interval: Period.OneHour,
    },
  },
  trigger: { kind: TriggerKind.EveryTime },
  expiration: null,
  actions,
  enabled: true,
  order: 1,
  createdAt: 0,
  updatedAt: 0,
});

/**
 * Build a replay over in-memory stores whose {@link IndicatorService} records
 * every `compute` call, delegating to the real service — the same recorder the
 * #550 regression suite uses.
 */
function buildRecordingReplay(
  candles: InMemoryCandleRepository,
  rules: Rule[],
): {
  replay: BacktestReplayService;
  computeCalls: Parameters<IndicatorService['compute']>[];
} {
  const watchlist = new InMemoryWatchlistRepository([watched]);
  const realService = new IndicatorService(defaultIndicators(), watchlist, candles);
  const computeCalls: Parameters<IndicatorService['compute']>[] = [];
  const recordingService: IndicatorService = Object.create(realService);
  recordingService.compute = (...args: Parameters<IndicatorService['compute']>) => {
    computeCalls.push(args);
    return realService.compute(...args);
  };
  const ruleRepo = new InMemoryRuleRepository(rules);
  const replay = new BacktestReplayService(candles, ruleRepo, watchlist, recordingService);
  return { replay, computeCalls };
}

/**
 * Replay `params` through the **pre-Phase-2 engine wiring** — the same loop
 * `BacktestReplayService.replay` runs, but with `wireRuleEngine` left on its
 * per-observation memo (no `runComputeCache`).
 *
 * This is the differential oracle: it pins the ADR-0021 baseline the run-scoped
 * memo must be byte-identical to, driven over the identical ordered feed.
 */
async function replayWithPerObservationMemo(
  candles: InMemoryCandleRepository,
  rules: Rule[],
  runParams: BacktestParams,
  strategy: BacktestStrategy,
  periods: Period[],
): Promise<BacktestReplayResult> {
  const watchlist = new InMemoryWatchlistRepository([watched]);
  const indicators = new IndicatorService(defaultIndicators(), watchlist, candles);
  const perPeriod = await Promise.all(
    periods.map(async (period) => ({
      period,
      candles: await candles.range(runParams.symbolId, period, runParams.start, runParams.end),
    })),
  );
  const feed = orderBacktestFeed(perPeriod);

  const eventLog = new InMemoryEventLog();
  const state = new InMemoryStateRepository();
  const profiles = new InMemoryProfileRepository([profile]);
  const ruleRepository = new InMemoryRuleRepository(
    rules.filter((rule) => rule.profileId === profile.id),
    profiles,
  );
  const indicatorStore = new IndicatorSeriesStore(candles, indicators);
  await registerIndicatorInstances({ store: indicatorStore, profiles });
  const notifier: Notifier = { send: async () => {} };
  const wired = await wireRuleEngine({
    rules: ruleRepository,
    oncePerBarLatch: new InMemoryOncePerBarLatchStore(),
    state,
    watchlist,
    notifier,
    eventLog,
    candleRepository: candles,
    indicatorStore,
  });

  const executor = new BacktestExecutor(strategy, {
    initialCapital: runParams.initialCapital,
    commission: runParams.commission,
  });
  const stepEvents: RuleEventEntry[] = [];
  const unsubscribe = eventLog.onAppend((entry, target) => {
    if (target.kind === 'symbol' && target.symbolId === runParams.symbolId) {
      stepEvents.push(entry);
    }
  });
  try {
    for (const item of feed) {
      feedCandleIntoEngine(wired, {
        id: runParams.symbolId,
        period: item.period,
        candle: item.candle,
        final: true,
      });
      await wired.drain();
      executor.processStep(item.candle, stepEvents.splice(0));
    }
  } finally {
    unsubscribe();
  }
  const outcome = executor.result();
  return {
    events: await eventLog.symbolEvents(runParams.symbolId),
    trades: outcome.trades,
    ...(outcome.openPosition === undefined ? {} : { openPosition: outcome.openPosition }),
    summary: outcome.summary,
    cancelled: false,
  };
}

/** An inert strategy — the count test records computes, it trades nothing. */
const inertStrategy: BacktestStrategy = {
  id: 'strat-1',
  name: 'Inert',
  description: '',
  entry: { signal: { key: '__no_such_key__', value: { type: StateValueType.Bool, value: true } } },
  exit: { profitTarget: { kind: BacktestThresholdKind.Percentage, amount: 5 } },
  createdAt: 0,
  updatedAt: 0,
};

/** A strategy entering on the rule's `signal` StateSet and exiting at +5%. */
const signalStrategy: BacktestStrategy = {
  id: 'strat-2',
  name: 'Signal entry',
  description: '',
  entry: { signal: { key: 'signal', value: { type: StateValueType.Bool, value: true } } },
  exit: { profitTarget: { kind: BacktestThresholdKind.Percentage, amount: 5 } },
  createdAt: 0,
  updatedAt: 0,
};

/**
 * Seed the shared two-period fixture: three pre-window 1h history bars (SMA
 * warmup), one 1h bar per replayed hour, and four 1m bars per hour.
 *
 * `hourCloses` are the in-window 1h closes (hour 0, hour 1, …);
 * `minuteCloses[h][i]` is the close of hour `h`'s i-th 15-minute-spaced 1m bar.
 */
async function seedTwoPeriodFixture(
  candles: InMemoryCandleRepository,
  hourCloses: readonly number[],
  minuteCloses: ReadonlyArray<readonly number[]>,
): Promise<void> {
  await candles.save(SYMBOL_ID, Period.OneHour, [
    candle(-3 * HOUR, 10),
    candle(-2 * HOUR, 10),
    candle(-HOUR, 10),
    ...hourCloses.map((close, hour) => candle(hour * HOUR, close)),
  ]);
  await candles.save(
    SYMBOL_ID,
    Period.OneMinute,
    minuteCloses.flatMap((closes, hour) =>
      closes.map((close, i) => candle(hour * HOUR + i * 15 * MINUTE, close)),
    ),
  );
}

describe('BacktestReplayService coarse-bar change-detection (#556 / ADR-0022)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('computes a coarse-period operand once per coarse-bar visibility span across a fine feed, not once per fine observation', async () => {
    // Two replayed hours: 8 fine (1m) + 2 coarse (1h) observations = 10 drains,
    // every one of them evaluating the per-tick rule that reads the 1h SMA. The
    // coarse operand's visible window only changes when a new 1h bar enters the
    // page, so the 10 observations collapse to exactly 2 computes — the
    // fixture's 5:1 fine-per-coarse period ratio, vs one compute per
    // observation on the pre-Phase-2 per-observation memo.
    const candles = new InMemoryCandleRepository();
    await seedTwoPeriodFixture(
      candles,
      [10, 10],
      [
        [10, 10, 10, 10],
        [10, 10, 10, 10],
      ],
    );
    const { replay, computeCalls } = buildRecordingReplay(candles, [coarseIndicatorRule(0, [])]);
    let steps = 0;

    await replay.replay(
      params(0, 2 * HOUR),
      inertStrategy,
      profile,
      [Period.OneMinute, Period.OneHour],
      {
        onStep: () => {
          steps += 1;
        },
      },
    );

    expect({ steps, computeCalls }).toEqual({
      steps: 10,
      computeCalls: [
        [
          SYMBOL_ID,
          'sma',
          { length: 3, source: 'close' },
          Period.OneHour,
          { from: -3 * HOUR, to: 1 },
        ],
        [
          SYMBOL_ID,
          'sma',
          { length: 3, source: 'close' },
          Period.OneHour,
          { from: -3 * HOUR, to: HOUR + 1 },
        ],
      ],
    });
  });

  it('produces a full-replay result byte-identical to the per-observation-memo path over a fixture that fires rules and trades', async () => {
    // The differential proof (ADR-0022): the run-scoped memo is a pure
    // work-elimination. The fixture crosses the coarse condition mid-run (1h
    // SMA rises above 20 from hour 1), fires the per-tick rule, opens a
    // position off its `signal` StateSet at close 100, and exits at the +5%
    // level intrabar — events, trades, and summary must equal the pre-Phase-2
    // engine (per-observation memo) driven over the identical ordered feed.
    // `Date.now` is frozen so the event log's wall-clock `firedAt` stamps
    // cannot mask or manufacture a difference.
    jest.spyOn(Date, 'now').mockReturnValue(1_234);
    const candles = new InMemoryCandleRepository();
    await seedTwoPeriodFixture(
      candles,
      [10, 100],
      [
        [10, 10, 11, 12],
        [100, 104, 106, 108],
      ],
    );
    const rules = [
      coarseIndicatorRule(20, [
        {
          kind: ActionKind.SetSymbolState,
          key: 'signal',
          value: { type: StateValueType.Bool, value: true },
        },
      ]),
    ];
    const runParams = params(0, 2 * HOUR);
    const periods = [Period.OneMinute, Period.OneHour];
    const oracle = await replayWithPerObservationMemo(
      candles,
      rules,
      runParams,
      signalStrategy,
      periods,
    );
    const { replay } = buildRecordingReplay(candles, rules);

    const actual = await replay.replay(runParams, signalStrategy, profile, periods);

    // Sanity that the fixture is non-trivial before the byte-compare: the run
    // fired and closed one profit-target round trip.
    expect(oracle.trades.length).toEqual(1);
    expect(actual).toEqual(oracle);
  });
});
