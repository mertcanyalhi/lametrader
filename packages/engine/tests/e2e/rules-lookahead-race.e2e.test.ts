import {
  ActionKind,
  ComparisonOperator,
  ConditionNodeKind,
  type EquityCandle,
  EvaluationTriggerKind,
  LeafConditionFamily,
  OperandKind,
  Period,
  type Rule,
  RuleEventType,
  RuleScopeKind,
  StateScope,
  StateValueType,
  SymbolType,
  TriggerKind,
} from '@lametrader/core';
import {
  IndicatorSeriesStore,
  InMemoryCandleRepository,
  InMemoryEventLog,
  InMemoryMarketDataSource,
  InMemoryNotifier,
  InMemoryRuleRepository,
  InMemoryStateRepository,
  InMemoryWatchlistRepository,
  PollingService,
  wireRuleEngine,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';

const SYMBOL = 'stock:AAPL';

/** Build an equity candle whose OHLC brackets `close`. */
function equityCandle(time: number, close: number): EquityCandle {
  return {
    type: SymbolType.Stock,
    time,
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
    volume: 1_000,
  };
}

/**
 * Build a `Close > 100` / `OncePerBarClose(1m)` rule under `profile-A` scoped
 * to the single test symbol; a state-set action makes each fire observable.
 */
function closeGt100Rule(): Rule {
  return {
    id: 'r-close',
    profileId: 'profile-A',
    name: 'close > 100 once per bar close',
    scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL },
    condition: {
      kind: ConditionNodeKind.Leaf,
      leaf: {
        family: LeafConditionFamily.Comparison,
        operator: ComparisonOperator.Gt,
        left: { kind: OperandKind.Close },
        right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 100 } },
        interval: Period.OneMinute,
      },
    },
    trigger: { kind: TriggerKind.OncePerBarClose, period: Period.OneMinute },
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

/**
 * Wire the real rule engine and a real `PollingService` over an in-memory
 * source that serves `bars` in one poll (reproducing `pollOne`'s synchronous
 * multi-candle rollover). Returns the event log and a `run()` that polls and
 * drains.
 */
async function harness(bars: EquityCandle[], now: number) {
  const rules = new InMemoryRuleRepository();
  await rules.save(closeGt100Rule());
  const state = new InMemoryStateRepository();
  const watchlist = new InMemoryWatchlistRepository();
  await watchlist.add({
    id: SYMBOL,
    type: SymbolType.Stock,
    description: 'Apple',
    exchange: 'NMS',
    periods: [Period.OneMinute],
  });
  const notifier = new InMemoryNotifier();
  const candleRepo = new InMemoryCandleRepository();
  // A prior stored bar so `pollOne` resumes (it skips symbols with no history).
  await candleRepo.save(SYMBOL, Period.OneMinute, [equityCandle(0, 100)]);
  const indicatorStore = new IndicatorSeriesStore();
  const eventLog = new InMemoryEventLog(() => 0);

  const wired = await wireRuleEngine({
    rules,
    state,
    watchlist,
    notifier,
    eventLog,
    candleRepository: candleRepo,
    indicatorStore,
  });

  const source = new InMemoryMarketDataSource(
    [{ id: SYMBOL, type: SymbolType.Stock, description: 'Apple', exchange: 'NMS' }],
    [SymbolType.Stock],
    [{ id: SYMBOL, period: Period.OneMinute, candles: bars }],
  );
  const polling = new PollingService([source], candleRepo, watchlist, {
    // Same fan-out shape as connect.ts: the polling candle drives the bar bridge.
    onCandle: (event) => wired.barBridge.handleCandle(event),
    intervals: { [Period.OneMinute]: 60_000 } as Record<Period, number>,
    now: () => now,
  });

  return {
    eventLog,
    async run(): Promise<void> {
      await polling.poll();
      await wired.drain();
    },
  };
}

describe('rules look-ahead race across a serialized rollover batch (e2e)', () => {
  it('a catch-up poll of two final bars fires once — for the bar whose close satisfies the rule, not the previous bar (regression #459)', async () => {
    // Bar A close 99 fails; bar B close 105 passes. Both closed (now past both).
    // Before #459 the OHLCV mirror advanced ahead of the queue, so bar A's
    // BarClosed read bar B's close and fired (mis-attributed at ts 60_000),
    // then bar B fired again — a double fire.
    const h = await harness([equityCandle(60_000, 99), equityCandle(120_000, 105)], 200_000);
    await h.run();

    expect(await h.eventLog.symbolEvents(SYMBOL)).toEqual([
      {
        type: RuleEventType.StateSet,
        ts: 120_000,
        firedAt: 0,
        ruleId: 'r-close',
        symbolId: SYMBOL,
        scope: StateScope.Symbol,
        key: 'fired',
        value: { type: StateValueType.Bool, value: true },
      },
      {
        type: RuleEventType.Fired,
        ts: 120_000,
        firedAt: 0,
        ruleId: 'r-close',
        symbolId: SYMBOL,
        context: {
          inboundEvent: {
            kind: EvaluationTriggerKind.BarClosed,
            ts: 120_000,
            symbolId: SYMBOL,
            period: Period.OneMinute,
          },
          lookupSnapshot: {
            current: null,
            open: 104,
            high: 106,
            low: 103,
            close: 105,
            volume: 1_000,
          },
        },
      },
    ]);
  });

  it('critical failure mode — the previous final bar reads its own close, not the newly-formed bar, so its fire is neither missed nor mis-snapshotted (regression #459)', async () => {
    // Bar A close 105 passes and is final; bar B close 95 fails and is still
    // forming (now < B's close). Before #459 the mirror already held bar B's
    // close (95) when bar A's BarClosed was evaluated, so the fire that bar A
    // earned was MISSED entirely (and any snapshot would carry bar B's values).
    const h = await harness([equityCandle(60_000, 105), equityCandle(120_000, 95)], 150_000);
    await h.run();

    expect(await h.eventLog.symbolEvents(SYMBOL)).toEqual([
      {
        type: RuleEventType.StateSet,
        ts: 60_000,
        firedAt: 0,
        ruleId: 'r-close',
        symbolId: SYMBOL,
        scope: StateScope.Symbol,
        key: 'fired',
        value: { type: StateValueType.Bool, value: true },
      },
      {
        type: RuleEventType.Fired,
        ts: 60_000,
        firedAt: 0,
        ruleId: 'r-close',
        symbolId: SYMBOL,
        context: {
          inboundEvent: {
            kind: EvaluationTriggerKind.BarClosed,
            ts: 60_000,
            symbolId: SYMBOL,
            period: Period.OneMinute,
          },
          lookupSnapshot: {
            current: null,
            open: 104,
            high: 106,
            low: 103,
            close: 105,
            volume: 1_000,
          },
        },
      },
    ]);
  });
});
