import {
  ActionKind,
  ConditionNodeKind,
  ConfigKey,
  type EquityCandle,
  type IndicatorStateEvent,
  NumericOperator,
  OperandKind,
  Period,
  type Rule,
  RuleEventKind,
  RuleScopeKind,
  type StateValue,
  StateValueType,
  type SymbolQuoteEvent,
  SymbolType,
  TriggerKind,
} from '@lametrader/core';
import {
  ActionRunner,
  CandleRuleEventBridge,
  ConfigService,
  defaultIndicators,
  type EvaluationLookups,
  IndicatorRuleEventBridge,
  IndicatorService,
  InMemoryCandleRepository,
  InMemoryConfigRepository,
  InMemoryEventLog,
  InMemoryFiringStateRepository,
  InMemoryMarketDataSource,
  InMemoryNotifier,
  InMemoryRuleRepository,
  InMemoryStateRepository,
  InMemoryWatchlistRepository,
  PollingService,
  QuoteRuleEventBridge,
  QuoteStreamService,
  RuleOrchestrator,
  TriggerEvaluator,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';

/**
 * E2e: prove the three stream services (`PollingService`,
 * `QuoteStreamService`, `IndicatorStreamService`) feed their respective
 * {@link CandleRuleEventBridge} / {@link QuoteRuleEventBridge} /
 * {@link IndicatorRuleEventBridge} unchanged, and the bridge events reach
 * the orchestrator and fire rules — including the prev/current cache
 * decoration on each inbound value axis.
 *
 * Each describe spins one stream service against an {@link
 * InMemoryMarketDataSource}, wires the bridge into a {@link RuleOrchestrator}
 * with in-memory adapters, and asserts the rule fires once for the expected
 * event and not again on a duplicate poll.
 */

const SYMBOL_ID = 'stock:AAPL';

/** Baseline lookups that return null for everything. */
function emptyLookups(): EvaluationLookups {
  return {
    getCurrentValue: () => null,
    getOpenValue: () => null,
    getHighValue: () => null,
    getLowValue: () => null,
    getCloseValue: () => null,
    getVolumeValue: () => null,
    getIndicatorValue: () => null,
    getSymbolState: () => null,
    getGlobalState: () => null,
  };
}

/** Build a minimally-valid rule with overrides. */
function rule(overrides: Partial<Rule> & Pick<Rule, 'id' | 'order'>): Rule {
  return {
    profileId: 'profile-1',
    name: overrides.id,
    scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
    condition: {
      kind: ConditionNodeKind.Leaf,
      left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
      operator: NumericOperator.Gt,
      right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 100 } },
    },
    trigger: { kind: TriggerKind.Once },
    expiration: null,
    actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: overrides.id }],
    enabled: true,
    events: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/** Build an equity {@link EquityCandle} (AAPL) from a few overrides. */
function equityCandle(
  time: number,
  values: { open: number; high: number; low: number; close: number; volume: number },
): EquityCandle {
  return {
    type: SymbolType.Stock,
    time,
    open: values.open,
    high: values.high,
    low: values.low,
    close: values.close,
    volume: values.volume,
  };
}

/**
 * One-shot harness wiring a {@link RuleOrchestrator} against in-memory
 * adapters, plus a sink the test connects its bridges to. The sink updates
 * the lookup caches based on the inbound event's `kind` so subsequent
 * `process()` calls see fresh OHLCV / indicator-value lookups.
 *
 * `drain()` lets the test wait until every chained `process()` call settles
 * — bridges that emit during a previous `process()` re-extend the chain.
 */
function buildDriver(seedRules: Rule[]) {
  const notifier = new InMemoryNotifier(['main']);
  const log = new InMemoryEventLog();
  const state = new InMemoryStateRepository();
  const firingState = new InMemoryFiringStateRepository();
  const rules = new InMemoryRuleRepository(seedRules);
  const watchlist = new InMemoryWatchlistRepository();
  const currentValues = new Map<string, number>();
  const openValues = new Map<string, number>();
  const highValues = new Map<string, number>();
  const lowValues = new Map<string, number>();
  const closeValues = new Map<string, number>();
  const volumeValues = new Map<string, number>();
  const indicatorValues = new Map<string, StateValue>();
  const lookups: EvaluationLookups = {
    ...emptyLookups(),
    getCurrentValue: (id) => currentValues.get(id) ?? null,
    getOpenValue: (id) => openValues.get(id) ?? null,
    getHighValue: (id) => highValues.get(id) ?? null,
    getLowValue: (id) => lowValues.get(id) ?? null,
    getCloseValue: (id) => closeValues.get(id) ?? null,
    getVolumeValue: (id) => volumeValues.get(id) ?? null,
    getIndicatorValue: (instanceId, stateKey) =>
      indicatorValues.get(`${instanceId}|${stateKey}`) ?? null,
  };
  const orchestrator = new RuleOrchestrator(
    rules,
    watchlist,
    lookups,
    state,
    log,
    new TriggerEvaluator(log, firingState),
    new ActionRunner(state, notifier, lookups),
  );
  let pending: Promise<void> = Promise.resolve();
  const sink = (event: Parameters<RuleOrchestrator['process']>[0]) => {
    updateCaches(event);
    pending = pending.then(() => orchestrator.process(event));
  };
  function updateCaches(event: Parameters<RuleOrchestrator['process']>[0]): void {
    switch (event.kind) {
      case RuleEventKind.CurrentValueChanged:
        if (event.current !== null) currentValues.set(event.symbolId, event.current);
        return;
      case RuleEventKind.OpenValueChanged:
        if (event.current !== null) openValues.set(event.symbolId, event.current);
        return;
      case RuleEventKind.HighValueChanged:
        if (event.current !== null) highValues.set(event.symbolId, event.current);
        return;
      case RuleEventKind.LowValueChanged:
        if (event.current !== null) lowValues.set(event.symbolId, event.current);
        return;
      case RuleEventKind.CloseValueChanged:
        if (event.current !== null) closeValues.set(event.symbolId, event.current);
        return;
      case RuleEventKind.VolumeValueChanged:
        if (event.current !== null) volumeValues.set(event.symbolId, event.current);
        return;
      case RuleEventKind.IndicatorValueChanged:
        if (event.current !== null) {
          indicatorValues.set(`${event.instanceId}|${event.stateKey}`, event.current);
        }
        return;
      default:
        return;
    }
  }
  return {
    notifier,
    log,
    sink,
    /**
     * Schedule an async piece of work on the same chain the bridge sink
     * extends, so test bodies can mix sync `onCandle` listeners (the candle
     * + quote services) with the async `IndicatorStreamService.handleCandle`.
     */
    enqueue(work: () => Promise<void>): void {
      pending = pending.then(work);
    },
    /**
     * Wait until the chain stops growing — chained `process()` calls that
     * emit new events re-extend the chain, so a single `await pending`
     * misses the tail.
     */
    async drain(): Promise<void> {
      let last: Promise<void> = pending;
      do {
        last = pending;
        await pending;
      } while (last !== pending);
    },
  };
}

/** Build an `InMemoryMarketDataSource` carrying just AAPL with the seeded candles. */
function buildSource(candles: EquityCandle[]): InMemoryMarketDataSource {
  return new InMemoryMarketDataSource(
    [
      {
        id: SYMBOL_ID,
        type: SymbolType.Stock,
        description: 'Apple',
        exchange: 'NMS',
      },
    ],
    [SymbolType.Stock],
    [{ id: SYMBOL_ID, period: Period.OneMinute, candles }],
  );
}

/** Build the watched-symbol record `PollingService` and the stream services need. */
function seedWatchlist(watchlist: InMemoryWatchlistRepository): Promise<void> {
  return watchlist.add({
    id: SYMBOL_ID,
    type: SymbolType.Stock,
    description: 'Apple',
    exchange: 'NMS',
    periods: [Period.OneMinute],
  });
}

describe('stream bridges (e2e)', () => {
  describe('PollingService → CandleRuleEventBridge → RuleOrchestrator', () => {
    it('fires the rule once on the inbound close and skips the duplicate re-poll', async () => {
      const driver = buildDriver([
        rule({
          id: 'close-above-100',
          order: 1,
          condition: {
            kind: ConditionNodeKind.Leaf,
            left: { kind: OperandKind.CloseValue, valueType: StateValueType.Number },
            operator: NumericOperator.Gt,
            right: {
              kind: OperandKind.Literal,
              value: { type: StateValueType.Number, value: 100 },
            },
          },
        }),
      ]);
      const candleRepo = new InMemoryCandleRepository();
      const watchlist = new InMemoryWatchlistRepository();
      await seedWatchlist(watchlist);
      await candleRepo.save(SYMBOL_ID, Period.OneMinute, [
        equityCandle(999_000, { open: 99, high: 99.5, low: 98.5, close: 99, volume: 1_000 }),
      ]);
      const source = buildSource([
        equityCandle(1_000_000, { open: 100, high: 106, low: 99, close: 105, volume: 1_500 }),
      ]);
      const bridge = new CandleRuleEventBridge((event) => driver.sink(event));
      const polling = new PollingService([source], candleRepo, watchlist, {
        onCandle: (event) => bridge.handleCandle(event),
        intervals: { [Period.OneMinute]: 60_000 } as Record<Period, number>,
        now: () => 1_500_000,
      });

      await polling.poll();
      await driver.drain();
      await polling.poll();
      await driver.drain();

      expect(driver.notifier.sent).toEqual([{ destinationName: 'main', body: 'close-above-100' }]);
    });
  });

  describe('QuoteStreamService → QuoteRuleEventBridge → RuleOrchestrator', () => {
    it('fires the rule on the QuoteStreamService-derived current price', async () => {
      const driver = buildDriver([rule({ id: 'price-above-100', order: 1 })]);
      const candleRepo = new InMemoryCandleRepository();
      const watchlist = new InMemoryWatchlistRepository();
      await seedWatchlist(watchlist);
      await candleRepo.save(SYMBOL_ID, Period.OneMinute, [
        equityCandle(998_000, { open: 98, high: 98.5, low: 97, close: 98, volume: 1_000 }),
        equityCandle(999_000, { open: 99, high: 99.5, low: 98.5, close: 99, volume: 1_100 }),
      ]);
      const source = buildSource([
        equityCandle(1_000_000, { open: 100, high: 106, low: 99, close: 105, volume: 1_500 }),
      ]);
      const config = new ConfigService(
        new InMemoryConfigRepository([
          [ConfigKey.Periods, [Period.OneMinute]],
          [ConfigKey.DefaultPeriod, Period.OneMinute],
        ]),
      );
      const bridge = new QuoteRuleEventBridge((event) => driver.sink(event));
      const quoteStream = new QuoteStreamService(watchlist, config, candleRepo, {
        onQuote: (event: SymbolQuoteEvent) => bridge.handleQuote(event),
      });
      await quoteStream.subscribe(SYMBOL_ID);
      const polling = new PollingService([source], candleRepo, watchlist, {
        onCandle: (event) => quoteStream.handleCandle(event),
        intervals: { [Period.OneMinute]: 60_000 } as Record<Period, number>,
        now: () => 1_500_000,
      });

      await polling.poll();
      await driver.drain();
      await polling.poll();
      await driver.drain();

      expect(driver.notifier.sent).toEqual([{ destinationName: 'main', body: 'price-above-100' }]);
    });
  });

  describe('IndicatorStreamService → IndicatorRuleEventBridge → RuleOrchestrator', () => {
    it('fires the rule on the SMA value computed by IndicatorStreamService', async () => {
      const instanceId = 'instance-1';
      const driver = buildDriver([
        rule({
          id: 'sma-above-100',
          order: 1,
          condition: {
            kind: ConditionNodeKind.Leaf,
            left: {
              kind: OperandKind.IndicatorRef,
              instanceId,
              stateKey: 'value',
              valueType: StateValueType.Number,
            },
            operator: NumericOperator.Gt,
            right: {
              kind: OperandKind.Literal,
              value: { type: StateValueType.Number, value: 100 },
            },
          },
        }),
      ]);
      const candleRepo = new InMemoryCandleRepository();
      const watchlist = new InMemoryWatchlistRepository();
      await seedWatchlist(watchlist);
      await candleRepo.save(SYMBOL_ID, Period.OneMinute, [
        equityCandle(998_000, { open: 98, high: 98.5, low: 97, close: 98, volume: 1_000 }),
        equityCandle(999_000, { open: 99, high: 99.5, low: 98.5, close: 99, volume: 1_100 }),
      ]);
      const source = buildSource([
        equityCandle(1_000_000, { open: 100, high: 106, low: 99, close: 105, volume: 1_500 }),
      ]);
      const indicators = defaultIndicators();
      const bridge = new IndicatorRuleEventBridge((event) => driver.sink(event));
      const indicatorService = new IndicatorService(indicators, watchlist, candleRepo, {
        onState: (event: IndicatorStateEvent) => bridge.handleState(event),
      });
      const subscriptionId = await indicatorService.subscribe({
        id: SYMBOL_ID,
        period: Period.OneMinute,
        indicatorKey: 'sma',
        inputs: { length: 2 },
      });
      bridge.bindSubscription(subscriptionId, instanceId);
      const polling = new PollingService([source], candleRepo, watchlist, {
        onCandle: (event) => {
          driver.enqueue(() => indicatorService.handleCandle(event));
        },
        intervals: { [Period.OneMinute]: 60_000 } as Record<Period, number>,
        now: () => 1_500_000,
      });

      await polling.poll();
      await driver.drain();

      expect(driver.notifier.sent).toEqual([{ destinationName: 'main', body: 'sma-above-100' }]);
    });
  });
});
