import type { CandleRepository } from '@lametrader/core';
import {
  ActionKind,
  type BacktestParams,
  type BacktestStrategy,
  BacktestThresholdKind,
  type Candle,
  ComparisonOperator,
  ConditionNodeKind,
  LeafConditionFamily,
  MovingOperator,
  NotificationChannel,
  OperandKind,
  Period,
  type Profile,
  ProfileScope,
  type Rule,
  RuleEventType,
  RuleScopeKind,
  StateValueType,
  SymbolType,
  TriggerKind,
  type WatchedSymbol,
} from '@lametrader/core';
import { InMemoryCandleRepository } from '../../market/persistence/in-memory-candle.repository.js';
import { InMemoryWatchlistRepository } from '../../market/persistence/in-memory-watchlist.repository.js';
import { defaultIndicators } from '../indicators/default-indicators.js';
import { InMemoryRuleRepository } from '../rules/in-memory-rule.repository.js';
import { BacktestReplayService } from './backtest-replay.service.js';

/** A {@link CandleRepository} decorator counting every candle-store read. */
class CountingCandleRepository implements CandleRepository {
  reads = 0;
  constructor(private readonly inner: CandleRepository) {}
  range(symbolId: string, period: Period, from: number, to: number, limit?: number) {
    this.reads += 1;
    return this.inner.range(symbolId, period, from, to, limit);
  }
  latestN(symbolId: string, period: Period, n: number, before?: number) {
    this.reads += 1;
    return this.inner.latestN(symbolId, period, n, before);
  }
  latest(symbolId: string, period: Period) {
    this.reads += 1;
    return this.inner.latest(symbolId, period);
  }
  save(symbolId: string, period: Period, candles: Candle[]) {
    return this.inner.save(symbolId, period, candles);
  }
  deleteSymbol(symbolId: string) {
    return this.inner.deleteSymbol(symbolId);
  }
}

const SYMBOL_ID = 'crypto:BTCUSDT';
const MINUTE = 60_000;
const HOUR = 3_600_000;

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

/** A watched symbol with the given active periods. */
const watched = (periods: Period[]): WatchedSymbol => ({
  id: SYMBOL_ID,
  type: SymbolType.Crypto,
  name: 'Bitcoin',
  exchange: 'Binance',
  periods,
});

/** Stamp a persisted rule from its mutable fields. */
const rule = (fields: Omit<Rule, 'id' | 'createdAt' | 'updatedAt'>, id = 'rule-1'): Rule => ({
  ...fields,
  id,
  createdAt: 0,
  updatedAt: 0,
});

/** The run params for `[start, end)` on the anchor period. */
const params = (start: number, end: number): BacktestParams => ({
  symbolId: SYMBOL_ID,
  profileId: 'prof-1',
  profileName: 'Momentum',
  period: Period.OneHour,
  start,
  end,
  initialCapital: 10_000,
  commission: {},
});

/** A strategy whose signals never match these rules' state keys — these tests assert only the recorded events, not trades. */
const strategy: BacktestStrategy = {
  id: 'strat-1',
  name: 'Inert',
  description: '',
  entry: { signal: { key: '__no_such_key__', value: { type: StateValueType.Bool, value: true } } },
  exit: { profitTarget: { kind: BacktestThresholdKind.Percentage, amount: 5 } },
  createdAt: 0,
  updatedAt: 0,
};

/** Build a replay over in-memory stores; the indicator registry is unused by these rules. */
function buildReplay(candles: CandleRepository, rules: Rule[], periods: Period[]) {
  const watchlist = new InMemoryWatchlistRepository([watched(periods)]);
  const ruleRepo = new InMemoryRuleRepository(rules);
  return new BacktestReplayService(candles, ruleRepo, watchlist, defaultIndicators());
}

/** A `Price > 100` rule firing every candle — its evaluation pages the bar series. */
const priceMarker = (): Rule =>
  rule({
    profileId: 'prof-1',
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
        key: 'fired',
        value: { type: StateValueType.Bool, value: true },
      },
    ],
    enabled: true,
    order: 1,
  });

/** Run a 1m replay over `count` in-range candles and return how many candle-store reads it made. */
async function countReadsForRun(count: number): Promise<number> {
  const inner = new InMemoryCandleRepository();
  await inner.save(
    SYMBOL_ID,
    Period.OneMinute,
    Array.from({ length: count }, (_, i) => candle(i * MINUTE, 150)),
  );
  const counting = new CountingCandleRepository(inner);
  const replay = buildReplay(counting, [priceMarker()], [Period.OneMinute]);
  await replay.replay(params(0, count * MINUTE), strategy, profile, [Period.OneMinute]);
  return counting.reads;
}

describe('BacktestReplayService replay', () => {
  it('feeds all active periods in completion order but ticks only the finest, so a coarser bar completing on the same boundary does not re-fire an EveryTime rule', async () => {
    const candles = new InMemoryCandleRepository();
    // A 1h bar at t=0 and a 1m bar at t=59m both complete at t=1h. The finest
    // observed period (1m) mints the tick; the 1h bar feeds its bar-lifecycle
    // events but no tick, mirroring live — so the EveryTime rule fires once,
    // from the 1m tick, not once per period.
    await candles.save(SYMBOL_ID, Period.OneHour, [candle(0, 150)]);
    await candles.save(SYMBOL_ID, Period.OneMinute, [candle(59 * MINUTE, 150)]);
    const everyTick = rule({
      profileId: 'prof-1',
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
          key: 'fired',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
      enabled: true,
      order: 1,
    });
    const replay = buildReplay(candles, [everyTick], [Period.OneHour, Period.OneMinute]);

    const result = await replay.replay(params(0, HOUR + 1), strategy, profile, [
      Period.OneHour,
      Period.OneMinute,
    ]);

    const stateSetTs = result.events
      .filter((e) => e.type === RuleEventType.StateSet)
      .map((e) => e.ts);
    expect(stateSetTs).toEqual([59 * MINUTE]);
  });

  it('records a NotificationSent event without delivering it', async () => {
    const candles = new InMemoryCandleRepository();
    await candles.save(SYMBOL_ID, Period.OneMinute, [candle(0, 150)]);
    const notifyRule = rule({
      profileId: 'prof-1',
      name: 'notify marker',
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
          kind: ActionKind.Notification,
          channel: NotificationChannel.Telegram,
          destinationName: 'main',
          template: 'price up',
        },
      ],
      enabled: true,
      order: 1,
    });
    const replay = buildReplay(candles, [notifyRule], [Period.OneMinute]);

    const result = await replay.replay(params(0, MINUTE + 1), strategy, profile, [
      Period.OneMinute,
    ]);

    expect(result.events.some((e) => e.type === RuleEventType.NotificationSent)).toBe(true);
  });

  it('resolves a rule lookback reaching before the start from stored history', async () => {
    const candles = new InMemoryCandleRepository();
    // The bar one back sits BEFORE the run window; only the in-range bar is fed,
    // so the MovingUp lookback must page the pre-start close from stored history.
    await candles.save(SYMBOL_ID, Period.OneMinute, [candle(-MINUTE, 100), candle(0, 110)]);
    const movingUp = rule({
      profileId: 'prof-1',
      name: 'moving up',
      scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.Moving,
          operator: MovingOperator.MovingUp,
          left: { kind: OperandKind.Close },
          threshold: 5,
          lookbackBars: 1,
          interval: Period.OneMinute,
        },
      },
      trigger: { kind: TriggerKind.OncePerBarClose, period: Period.OneMinute },
      expiration: null,
      actions: [
        {
          kind: ActionKind.SetSymbolState,
          key: 'up',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
      enabled: true,
      order: 1,
    });
    const replay = buildReplay(candles, [movingUp], [Period.OneMinute]);

    const result = await replay.replay(params(0, MINUTE + 1), strategy, profile, [
      Period.OneMinute,
    ]);

    expect(result.events.some((e) => e.type === RuleEventType.StateSet && e.key === 'up')).toBe(
      true,
    );
  });

  it('reads the candle store a fixed number of times regardless of how many candles it replays', async () => {
    // A short and a long run over the same series both read the store only for
    // the one-off preload (per period: one range + one below-floor probe) — the
    // drains issue no per-candle round-trips (ADR-0022).
    const fewReads = await countReadsForRun(3);
    const manyReads = await countReadsForRun(60);

    expect({ fewReads, manyReads }).toEqual({ fewReads: 2, manyReads: 2 });
  });

  it('yields the event loop during the replay so a concurrent poll runs before it finishes', async () => {
    // The in-memory replay only awaits microtasks, so without a periodic yield it
    // blocks the loop end-to-end and a concurrent `GET /backtests/:id` progress
    // read cannot run until the run completes (progress jumps 0 → 100). A feed
    // longer than the yield interval must let a macrotask scheduled alongside it
    // run while the replay is still in flight.
    const inner = new InMemoryCandleRepository();
    await inner.save(
      SYMBOL_ID,
      Period.OneMinute,
      Array.from({ length: 201 }, (_, i) => candle(i * MINUTE, 150)),
    );
    const replay = buildReplay(inner, [priceMarker()], [Period.OneMinute]);
    let done = false;
    const run = replay
      .replay(params(0, 201 * MINUTE), strategy, profile, [Period.OneMinute])
      .then(() => {
        done = true;
      });

    const interleavedMidRun = await new Promise<boolean>((resolve) => {
      setImmediate(() => resolve(!done));
    });
    await run;

    expect(interleavedMidRun).toEqual(true);
  });
});
