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
import { IndicatorService } from '../indicators/indicator.service.js';
import { InMemoryRuleRepository } from '../rules/in-memory-rule.repository.js';
import { BacktestReplayService } from './backtest-replay.service.js';

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

/** Build a replay over in-memory stores; the indicator service is unused by these rules. */
function buildReplay(candles: InMemoryCandleRepository, rules: Rule[], periods: Period[]) {
  const watchlist = new InMemoryWatchlistRepository([watched(periods)]);
  const indicators = new IndicatorService(defaultIndicators(), watchlist, candles, {
    onState: () => {},
  });
  const ruleRepo = new InMemoryRuleRepository(rules);
  return new BacktestReplayService(candles, ruleRepo, watchlist, indicators);
}

describe('BacktestReplayService replay', () => {
  it('feeds all active periods in completion order, ties finest-period-first (recorded event order)', async () => {
    const candles = new InMemoryCandleRepository();
    // A 1h bar at t=0 and a 1m bar at t=59m both complete at t=1h — a tie the
    // feed must break finest-first, so the 1m fire is recorded before the 1h.
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
    expect(stateSetTs).toEqual([59 * MINUTE, 0]);
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

  it('invokes onStep once per fed candle in completion order with the candle and progress', async () => {
    const candles = new InMemoryCandleRepository();
    // Same tie as the ordering test: a 1h bar at t=0 and a 1m bar at t=59m both
    // complete at t=1h, so onStep must fire finest-first (the 1m before the 1h).
    await candles.save(SYMBOL_ID, Period.OneHour, [candle(0, 150)]);
    await candles.save(SYMBOL_ID, Period.OneMinute, [candle(59 * MINUTE, 150)]);
    const replay = buildReplay(candles, [], [Period.OneHour, Period.OneMinute]);
    const steps: Array<{ period: Period; time: number; elapsedDays: number; totalDays: number }> =
      [];

    await replay.replay(
      params(0, HOUR + 1),
      strategy,
      profile,
      [Period.OneHour, Period.OneMinute],
      {
        onStep: (step) =>
          steps.push({
            period: step.candle.period,
            time: step.candle.candle.time,
            elapsedDays: step.progress.elapsedDays,
            totalDays: step.progress.totalDays,
          }),
      },
    );

    expect(steps).toEqual([
      {
        period: Period.OneMinute,
        time: 59 * MINUTE,
        elapsedDays: HOUR / 86_400_000,
        totalDays: (HOUR + 1) / 86_400_000,
      },
      {
        period: Period.OneHour,
        time: 0,
        elapsedDays: HOUR / 86_400_000,
        totalDays: (HOUR + 1) / 86_400_000,
      },
    ]);
  });
});
