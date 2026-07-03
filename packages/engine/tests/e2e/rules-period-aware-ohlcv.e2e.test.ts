import {
  ActionKind,
  type Candle,
  ComparisonOperator,
  ConditionNodeKind,
  EvaluationTriggerKind,
  LeafConditionFamily,
  OperandKind,
  Period,
  type Rule,
  RuleEventType,
  RuleScopeKind,
  StateScope,
  StateValueType,
  type SymbolQuoteEvent,
  SymbolType,
  TriggerKind,
} from '@lametrader/core';
import {
  IndicatorSeriesStore,
  InMemoryCandleRepository,
  InMemoryEventLog,
  InMemoryNotifier,
  InMemoryRuleRepository,
  InMemoryStateRepository,
  InMemoryWatchlistRepository,
  type WiredRuleEngine,
  wireRuleEngine,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';

const SYMBOL = 'BTCUSDT';

/** A crypto candle whose OHLC brackets `open` (open == the axis under test). */
function cryptoCandle(time: number, open: number): Candle {
  return {
    type: SymbolType.Crypto,
    time,
    open,
    high: open + 100,
    low: open - 100,
    close: open,
    volume: 10,
    quoteVolume: open * 10,
    trades: 1,
  };
}

/** Feed a forming candle for `(period)` through the bar bridge. */
function feedCandle(wired: WiredRuleEngine, period: Period, time: number, open: number): void {
  wired.barBridge.handleCandle({
    id: SYMBOL,
    period,
    candle: cryptoCandle(time, open),
    final: false,
  });
}

/** Feed a tick (drives `OncePerBar` evaluation) through the tick bridge. */
function feedTick(wired: WiredRuleEngine, time: number, price: number): void {
  const event: SymbolQuoteEvent = {
    subscriptionId: 'sub-1',
    id: SYMBOL,
    period: Period.OneMinute,
    quote: { price, change: 0, changePct: 0, time },
    final: false,
  };
  wired.tickBridge.handleQuote(event);
}

/**
 * `Open > 50000` scoped to the 1h bar (`interval: 1h`), tick-cadence
 * `OncePerBar(1h)`; a state-set action makes each fire observable.
 */
function openGt50kOn1hRule(): Rule {
  return {
    id: 'r-open-1h',
    profileId: 'profile-A',
    name: 'open > 50000 on the 1h bar',
    scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL },
    condition: {
      kind: ConditionNodeKind.Leaf,
      leaf: {
        family: LeafConditionFamily.Comparison,
        operator: ComparisonOperator.Gt,
        left: { kind: OperandKind.Open },
        right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 50000 } },
        interval: Period.OneHour,
      },
    },
    trigger: { kind: TriggerKind.OncePerBar, period: Period.OneHour },
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
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('period-aware OHLCV rule evaluation (e2e)', () => {
  it('fires the 1h-scoped rule off the 1h open even while the 1m open sits below the threshold', async () => {
    const rules = new InMemoryRuleRepository();
    await rules.save(openGt50kOn1hRule());
    const state = new InMemoryStateRepository();
    const watchlist = new InMemoryWatchlistRepository();
    await watchlist.add({
      id: SYMBOL,
      type: SymbolType.Crypto,
      description: 'Bitcoin',
      exchange: 'Binance',
      periods: [Period.OneMinute, Period.OneHour],
    });
    const eventLog = new InMemoryEventLog(() => 0);
    const wired = await wireRuleEngine({
      rules,
      state,
      watchlist,
      notifier: new InMemoryNotifier(),
      eventLog,
      candleRepository: new InMemoryCandleRepository(),
      indicatorStore: new IndicatorSeriesStore(),
    });

    // 1h bar opens at 50100 (above); 1m bar opens at 49000 (below).
    feedCandle(wired, Period.OneHour, 3_600_000, 50100);
    feedCandle(wired, Period.OneMinute, 3_660_000, 49000);
    // A tick drives OncePerBar evaluation; it reads Open at the 1h interval.
    feedTick(wired, 3_660_001, 49500);
    await wired.drain();

    expect(await eventLog.symbolEvents(SYMBOL)).toEqual([
      {
        type: RuleEventType.StateSet,
        ts: 3_660_001,
        firedAt: 0,
        ruleId: 'r-open-1h',
        symbolId: SYMBOL,
        scope: StateScope.Symbol,
        key: 'fired',
        value: { type: StateValueType.Bool, value: true },
      },
      {
        type: RuleEventType.Fired,
        ts: 3_660_001,
        firedAt: 0,
        ruleId: 'r-open-1h',
        symbolId: SYMBOL,
        context: {
          inboundEvent: {
            kind: EvaluationTriggerKind.Tick,
            ts: 3_660_001,
            symbolId: SYMBOL,
            price: 49500,
          },
          lookupSnapshot: {
            period: Period.OneHour,
            current: 49500,
            open: 50100,
            high: 50200,
            low: 50000,
            close: 50100,
            volume: 10,
          },
        },
      },
    ]);
  });

  it('critical failure mode — does NOT fire off a 1m open that crosses the threshold when the 1h open is below it (regression #463)', async () => {
    const rules = new InMemoryRuleRepository();
    await rules.save(openGt50kOn1hRule());
    const state = new InMemoryStateRepository();
    const watchlist = new InMemoryWatchlistRepository();
    await watchlist.add({
      id: SYMBOL,
      type: SymbolType.Crypto,
      description: 'Bitcoin',
      exchange: 'Binance',
      periods: [Period.OneMinute, Period.OneHour],
    });
    const eventLog = new InMemoryEventLog(() => 0);
    const wired = await wireRuleEngine({
      rules,
      state,
      watchlist,
      notifier: new InMemoryNotifier(),
      eventLog,
      candleRepository: new InMemoryCandleRepository(),
      indicatorStore: new IndicatorSeriesStore(),
    });

    // 1h bar opens at 49900 (below); repeated 1m bars open at 50010 (above).
    feedCandle(wired, Period.OneHour, 3_600_000, 49900);
    feedCandle(wired, Period.OneMinute, 3_660_000, 50010);
    feedTick(wired, 3_660_001, 50010);
    feedCandle(wired, Period.OneMinute, 3_720_000, 50020);
    feedTick(wired, 3_720_001, 50020);
    await wired.drain();

    // Pre-fix the period-agnostic mirror held the 1m open (50010/50020) when the
    // tick evaluated, firing the 1h rule. Period-aware resolution reads the 1h
    // open (49900), which fails the condition — no fire.
    expect(await eventLog.symbolEvents(SYMBOL)).toEqual([]);
    expect(await state.getSymbolState('profile-A', SYMBOL, 'fired')).toBeNull();
  });
});
