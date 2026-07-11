import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type BacktestParams,
  type BacktestStrategy,
  BacktestThresholdKind,
  type Candle,
  ComparisonOperator,
  ConditionNodeKind,
  type IndicatorInstance,
  LeafConditionFamily,
  OperandKind,
  Period,
  type Profile,
  ProfileScope,
  type Rule,
  RuleScopeKind,
  StateValueType,
  SymbolType,
  type Trigger,
  TriggerKind,
  type WatchedSymbol,
} from '@lametrader/core';
import { InMemoryCandleRepository } from '../../market/persistence/in-memory-candle.repository.js';
import { InMemoryWatchlistRepository } from '../../market/persistence/in-memory-watchlist.repository.js';
import { defaultIndicators } from '../indicators/default-indicators.js';
import { IndicatorService } from '../indicators/indicator.service.js';
import { InMemoryRuleRepository } from '../rules/in-memory-rule.repository.js';
import {
  BacktestReplayService,
  type ReplayIndicatorServiceFactory,
} from './backtest-replay.service.js';

const SYMBOL_ID = 'crypto:BTCUSDT';
const PERIOD = Period.OneMinute;
const MINUTE = 60_000;

/** The one SMA instance every fanned trigger event of the replayed candle reads. */
const SMA_INSTANCE_ID = 'sma-3-inst';
/** The SMA inputs — one shared operand identity across every fanned event. */
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

/** A watched crypto symbol on the 1m period. */
const watched: WatchedSymbol = {
  id: SYMBOL_ID,
  type: SymbolType.Crypto,
  description: 'Bitcoin',
  exchange: 'Binance',
  periods: [PERIOD],
};

/** The run params for `[start, end)` on the 1m period. */
const params = (start: number, end: number): BacktestParams => ({
  symbolId: SYMBOL_ID,
  profileId: 'prof-1',
  profileName: 'Momentum',
  period: PERIOD,
  start,
  end,
  initialCapital: 10_000,
  commission: {},
});

/** A strategy whose signal never matches these rules — the run records only, trades nothing. */
const strategy: BacktestStrategy = {
  id: 'strat-1',
  name: 'Inert',
  description: '',
  entry: { signal: { key: '__no_such_key__', value: { type: StateValueType.Bool, value: true } } },
  exit: { profitTarget: { kind: BacktestThresholdKind.Percentage, amount: 5 } },
  createdAt: 0,
  updatedAt: 0,
};

/**
 * A `BTC` rule whose condition compares the shared SMA operand against 0 on the
 * 1m interval, so evaluating it always reads the indicator operand (and would,
 * without the shared memo, drive one `IndicatorService.compute` per event).
 */
const indicatorRule = (id: string, order: number, trigger: Trigger): Rule => ({
  id,
  profileId: 'prof-1',
  name: id,
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
      right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
      interval: PERIOD,
    },
  },
  trigger,
  expiration: null,
  actions: [],
  enabled: true,
  order,
  createdAt: 0,
  updatedAt: 0,
});

/**
 * Build a replay over in-memory stores whose {@link IndicatorService} records
 * every `compute` call, delegating to the real service — the `Object.create` +
 * method-override recorder the engine's #548 regression test uses, so a test can
 * assert how many times the shared operand was computed across a replay.
 */
function buildRecordingReplay(
  candles: InMemoryCandleRepository,
  rules: Rule[],
): {
  replay: BacktestReplayService;
  computeCalls: Parameters<IndicatorService['compute']>[];
} {
  const watchlist = new InMemoryWatchlistRepository([watched]);
  const computeCalls: Parameters<IndicatorService['compute']>[] = [];
  // The replay builds its indicator service over the run's preloaded in-memory
  // store; the recorder wraps that same service so the memo it exercises is the
  // one actually driving the run.
  const makeIndicators: ReplayIndicatorServiceFactory = (preloaded) => {
    const realService = new IndicatorService(defaultIndicators(), watchlist, preloaded);
    const recordingService: IndicatorService = Object.create(realService);
    recordingService.compute = (...args: Parameters<IndicatorService['compute']>) => {
      computeCalls.push(args);
      return realService.compute(...args);
    };
    return recordingService;
  };
  const ruleRepo = new InMemoryRuleRepository(rules);
  const replay = new BacktestReplayService(candles, ruleRepo, watchlist, makeIndicators);
  return { replay, computeCalls };
}

describe('BacktestReplayService shared-seam indicator compute memo (regression #550)', () => {
  it('computes a shared indicator operand once for the trigger events one replayed candle fans out', async () => {
    // Three rules reference the same SMA operand, one per fanned event kind:
    // BarOpened, BarClosed, and the per-poll Tick. The replayed candle at 180_000
    // fans into all three; the two earlier bars sit before the run window, so they
    // are lookback history the pager reads — not fed candles. Without the shared
    // per-observation memo each event would recompute the byte-identical operand;
    // with it the whole drain drives exactly one compute.
    const candles = new InMemoryCandleRepository();
    await candles.save(SYMBOL_ID, PERIOD, [
      candle(60_000, 10),
      candle(120_000, 20),
      candle(180_000, 30),
    ]);
    const { replay, computeCalls } = buildRecordingReplay(candles, [
      indicatorRule('r-open', 1, { kind: TriggerKind.OncePerBarOpen, period: PERIOD }),
      indicatorRule('r-close', 2, { kind: TriggerKind.OncePerBarClose, period: PERIOD }),
      indicatorRule('r-tick', 3, { kind: TriggerKind.EveryTime }),
    ]);

    await replay.replay(params(180_000, 180_001), strategy, profile, [PERIOD]);

    expect(computeCalls).toEqual([
      [SYMBOL_ID, 'sma', { length: 3, source: 'close' }, PERIOD, { from: 60_000, to: 180_001 }],
    ]);
  });

  it('recomputes the shared operand on the next replayed candle because the memo is per observation', async () => {
    // Two consecutive in-window bars. Within each candle's drain the memo collapses
    // BarOpened + BarClosed + Tick to one compute; across bars the first memo dies
    // with its batch and the wider window keys a fresh compute — so exactly one
    // compute per replayed candle, each over its own advancing window, no stale
    // value leaking across bars.
    const candles = new InMemoryCandleRepository();
    await candles.save(SYMBOL_ID, PERIOD, [
      candle(60_000, 10),
      candle(120_000, 20),
      candle(180_000, 30),
      candle(240_000, 40),
    ]);
    const { replay, computeCalls } = buildRecordingReplay(candles, [
      indicatorRule('r-open', 1, { kind: TriggerKind.OncePerBarOpen, period: PERIOD }),
      indicatorRule('r-close', 2, { kind: TriggerKind.OncePerBarClose, period: PERIOD }),
      indicatorRule('r-tick', 3, { kind: TriggerKind.EveryTime }),
    ]);

    await replay.replay(params(180_000, 240_001), strategy, profile, [PERIOD]);

    expect(computeCalls).toEqual([
      [SYMBOL_ID, 'sma', { length: 3, source: 'close' }, PERIOD, { from: 60_000, to: 180_001 }],
      [SYMBOL_ID, 'sma', { length: 3, source: 'close' }, PERIOD, { from: 60_000, to: 240_001 }],
    ]);
  });

  it('relies on the shared engine seam, holding no per-consumer compute Proxy in the replay service', () => {
    // #550 records why a per-consumer `Proxy` memo over `IndicatorService.compute`
    // (method-name interception, a `JSON.stringify` cache key, per-drain lifetime)
    // must not back the backtest path. This locks the service to the shared seam:
    // the source must carry none of those rejected constructs, so any dedup can
    // only come from the engine's per-observation memo, never a backtest-local one.
    const source = readFileSync(join(__dirname, 'backtest-replay.service.ts'), 'utf8');

    expect({
      proxy: /\bProxy\b/.test(source),
      memoizeCompute: /memoizeCompute/.test(source),
      methodNameInterception: /===\s*['"]compute['"]/.test(source),
      jsonStringifyKey: /JSON\.stringify/.test(source),
    }).toEqual({
      proxy: false,
      memoizeCompute: false,
      methodNameInterception: false,
      jsonStringifyKey: false,
    });
  });
});
