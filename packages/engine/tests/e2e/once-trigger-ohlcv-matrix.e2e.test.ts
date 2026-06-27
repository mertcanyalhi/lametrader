import {
  ActionKind,
  ConditionNodeKind,
  type EquityCandle,
  NumericOperator,
  OperandKind,
  Period,
  type Rule,
  RuleEventKind,
  RuleEventType,
  RuleScopeKind,
  StateValueType,
  SymbolType,
  TriggerKind,
} from '@lametrader/core';
import {
  InMemoryEventLog,
  InMemoryFiringStateRepository,
  InMemoryNotifier,
  InMemoryRuleRepository,
  InMemoryStateRepository,
  InMemoryWatchlistRepository,
  wireRuleEngine,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';

/**
 * E2e for #314 — covers the `Once` trigger against every inbound OHLCV
 * operand kind. Drives `SymbolQuoteEvent`s (CurrentValue) and `CandleEvent`s
 * (OpenValue/HighValue/LowValue/CloseValue/VolumeValue) through the real
 * bridges into a real orchestrator wired against in-memory adapters.
 *
 * Each test asserts that a qualifying input fires the rule exactly once,
 * sends exactly one notification, and auto-disables the persisted rule so
 * subsequent qualifying inputs do not refire (#302).
 *
 * Note on the candle path: `CandleRuleEventBridge` fans out one event per
 * OHLCV field synchronously. `wireRuleEngine`'s enqueue updates
 * `LiveEvaluationLookups` *before* the per-symbol serializer starts
 * processing, so by the time the orchestrator processes the first emitted
 * event (`OpenValueChanged`) every axis is already populated in the
 * snapshot — and any OHLCV-axis rule whose lookup satisfies the condition
 * fires on the open event of the bar that drove the fanout.
 */

const SYMBOL_ID = 'stock:AAPL';
const PROFILE_ID = 'profile-1';

/** Operand kinds covered by this matrix — every OHLCV axis the engine reads. */
type OhlcvOperand =
  | OperandKind.CurrentValue
  | OperandKind.OpenValue
  | OperandKind.HighValue
  | OperandKind.LowValue
  | OperandKind.CloseValue
  | OperandKind.VolumeValue;

/**
 * Build a minimally-valid Once-triggered rule on the matrix's symbol with a
 * `<operand> > threshold` condition and one telegram notification.
 */
function onceRule(id: string, operand: OhlcvOperand, threshold: number): Rule {
  return {
    id,
    profileId: PROFILE_ID,
    name: id,
    scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
    condition: {
      kind: ConditionNodeKind.Leaf,
      left: { kind: operand, valueType: StateValueType.Number },
      operator: NumericOperator.Gt,
      right: {
        kind: OperandKind.Literal,
        value: { type: StateValueType.Number, value: threshold },
      },
    },
    trigger: { kind: TriggerKind.Once },
    expiration: null,
    actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: id }],
    enabled: true,
    events: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
    order: 1,
  };
}

/** Build an equity candle with all OHLCV axes specified. */
function candle(
  time: number,
  axes: { open: number; high: number; low: number; close: number; volume: number },
): EquityCandle {
  return { type: SymbolType.Stock, time, ...axes };
}

/**
 * Stand up the in-memory rule chain via `wireRuleEngine` so the bridges,
 * orchestrator, lookups, and per-symbol serializer are exactly the
 * production wiring (#290).
 */
function buildDriver(seedRule: Rule) {
  const rules = new InMemoryRuleRepository([seedRule]);
  const watchlist = new InMemoryWatchlistRepository();
  const state = new InMemoryStateRepository();
  const notifier = new InMemoryNotifier(['main']);
  const eventLog = new InMemoryEventLog(() => 999);
  const firingState = new InMemoryFiringStateRepository();
  const wired = wireRuleEngine({ rules, watchlist, state, notifier, eventLog, firingState });
  return { rules, notifier, eventLog, wired };
}

describe('Once trigger × OHLCV operand matrix (e2e)', () => {
  it('fires exactly once on a qualifying SymbolQuoteEvent for `Once × CurrentValue` and auto-disables', async () => {
    const driver = buildDriver(onceRule('current-once', OperandKind.CurrentValue, 100));

    driver.wired.quoteBridge.handleQuote({
      subscriptionId: 's',
      id: SYMBOL_ID,
      period: Period.OneMinute,
      quote: { price: 150, change: 0, changePct: 0, time: 1000 },
      final: false,
    });
    await driver.wired.drain();

    driver.wired.quoteBridge.handleQuote({
      subscriptionId: 's',
      id: SYMBOL_ID,
      period: Period.OneMinute,
      quote: { price: 160, change: 0, changePct: 0, time: 2000 },
      final: false,
    });
    driver.wired.quoteBridge.handleQuote({
      subscriptionId: 's',
      id: SYMBOL_ID,
      period: Period.OneMinute,
      quote: { price: 170, change: 0, changePct: 0, time: 3000 },
      final: false,
    });
    driver.wired.quoteBridge.handleQuote({
      subscriptionId: 's',
      id: SYMBOL_ID,
      period: Period.OneMinute,
      quote: { price: 180, change: 0, changePct: 0, time: 4000 },
      final: false,
    });
    await driver.wired.drain();

    const fired = (await driver.eventLog.ruleEvents('current-once')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    const stored = await driver.rules.get('current-once');
    expect({ notified: driver.notifier.sent, fired, enabled: stored?.enabled }).toEqual({
      notified: [{ destinationName: 'main', body: 'current-once' }],
      fired: [
        {
          type: RuleEventType.Fired,
          ts: 1000,
          ruleId: 'current-once',
          symbolId: SYMBOL_ID,
          firedAt: 999,
          context: {
            inboundEvent: {
              kind: RuleEventKind.CurrentValueChanged,
              ts: 1000,
              symbolId: SYMBOL_ID,
              prev: null,
              current: 150,
              final: false,
            },
            lookupSnapshot: {
              current: 150,
              open: null,
              high: null,
              low: null,
              close: null,
              volume: null,
            },
          },
        },
      ],
      enabled: false,
    });
  });

  it('fires exactly once on a qualifying CandleEvent for `Once × OpenValue` and auto-disables', async () => {
    const driver = buildDriver(onceRule('open-once', OperandKind.OpenValue, 100));

    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(1000, { open: 200, high: 205, low: 195, close: 204, volume: 1_000 }),
      final: false,
    });
    await driver.wired.drain();

    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(2000, { open: 300, high: 305, low: 295, close: 304, volume: 1_100 }),
      final: false,
    });
    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(3000, { open: 400, high: 405, low: 395, close: 404, volume: 1_200 }),
      final: false,
    });
    await driver.wired.drain();

    const fired = (await driver.eventLog.ruleEvents('open-once')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    const stored = await driver.rules.get('open-once');
    expect({ notified: driver.notifier.sent, fired, enabled: stored?.enabled }).toEqual({
      notified: [{ destinationName: 'main', body: 'open-once' }],
      fired: [
        {
          type: RuleEventType.Fired,
          ts: 1000,
          ruleId: 'open-once',
          symbolId: SYMBOL_ID,
          firedAt: 999,
          context: {
            inboundEvent: {
              kind: RuleEventKind.OpenValueChanged,
              ts: 1000,
              symbolId: SYMBOL_ID,
              prev: null,
              current: 200,
              final: false,
            },
            lookupSnapshot: {
              current: 204,
              open: 200,
              high: 205,
              low: 195,
              close: 204,
              volume: 1_000,
            },
          },
        },
      ],
      enabled: false,
    });
  });

  it('fires exactly once on a qualifying CandleEvent for `Once × HighValue` and auto-disables', async () => {
    const driver = buildDriver(onceRule('high-once', OperandKind.HighValue, 100));

    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(1000, { open: 200, high: 205, low: 195, close: 204, volume: 1_000 }),
      final: false,
    });
    await driver.wired.drain();

    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(2000, { open: 300, high: 305, low: 295, close: 304, volume: 1_100 }),
      final: false,
    });
    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(3000, { open: 400, high: 405, low: 395, close: 404, volume: 1_200 }),
      final: false,
    });
    await driver.wired.drain();

    const fired = (await driver.eventLog.ruleEvents('high-once')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    const stored = await driver.rules.get('high-once');
    expect({ notified: driver.notifier.sent, fired, enabled: stored?.enabled }).toEqual({
      notified: [{ destinationName: 'main', body: 'high-once' }],
      fired: [
        {
          type: RuleEventType.Fired,
          ts: 1000,
          ruleId: 'high-once',
          symbolId: SYMBOL_ID,
          firedAt: 999,
          context: {
            inboundEvent: {
              kind: RuleEventKind.OpenValueChanged,
              ts: 1000,
              symbolId: SYMBOL_ID,
              prev: null,
              current: 200,
              final: false,
            },
            lookupSnapshot: {
              current: 204,
              open: 200,
              high: 205,
              low: 195,
              close: 204,
              volume: 1_000,
            },
          },
        },
      ],
      enabled: false,
    });
  });

  it('fires exactly once on a qualifying CandleEvent for `Once × LowValue` and auto-disables', async () => {
    const driver = buildDriver(onceRule('low-once', OperandKind.LowValue, 100));

    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(1000, { open: 200, high: 205, low: 195, close: 204, volume: 1_000 }),
      final: false,
    });
    await driver.wired.drain();

    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(2000, { open: 300, high: 305, low: 295, close: 304, volume: 1_100 }),
      final: false,
    });
    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(3000, { open: 400, high: 405, low: 395, close: 404, volume: 1_200 }),
      final: false,
    });
    await driver.wired.drain();

    const fired = (await driver.eventLog.ruleEvents('low-once')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    const stored = await driver.rules.get('low-once');
    expect({ notified: driver.notifier.sent, fired, enabled: stored?.enabled }).toEqual({
      notified: [{ destinationName: 'main', body: 'low-once' }],
      fired: [
        {
          type: RuleEventType.Fired,
          ts: 1000,
          ruleId: 'low-once',
          symbolId: SYMBOL_ID,
          firedAt: 999,
          context: {
            inboundEvent: {
              kind: RuleEventKind.OpenValueChanged,
              ts: 1000,
              symbolId: SYMBOL_ID,
              prev: null,
              current: 200,
              final: false,
            },
            lookupSnapshot: {
              current: 204,
              open: 200,
              high: 205,
              low: 195,
              close: 204,
              volume: 1_000,
            },
          },
        },
      ],
      enabled: false,
    });
  });

  it('fires exactly once on a qualifying CandleEvent for `Once × CloseValue` and auto-disables', async () => {
    const driver = buildDriver(onceRule('close-once', OperandKind.CloseValue, 100));

    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(1000, { open: 200, high: 205, low: 195, close: 204, volume: 1_000 }),
      final: false,
    });
    await driver.wired.drain();

    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(2000, { open: 300, high: 305, low: 295, close: 304, volume: 1_100 }),
      final: false,
    });
    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(3000, { open: 400, high: 405, low: 395, close: 404, volume: 1_200 }),
      final: false,
    });
    await driver.wired.drain();

    const fired = (await driver.eventLog.ruleEvents('close-once')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    const stored = await driver.rules.get('close-once');
    expect({ notified: driver.notifier.sent, fired, enabled: stored?.enabled }).toEqual({
      notified: [{ destinationName: 'main', body: 'close-once' }],
      fired: [
        {
          type: RuleEventType.Fired,
          ts: 1000,
          ruleId: 'close-once',
          symbolId: SYMBOL_ID,
          firedAt: 999,
          context: {
            inboundEvent: {
              kind: RuleEventKind.OpenValueChanged,
              ts: 1000,
              symbolId: SYMBOL_ID,
              prev: null,
              current: 200,
              final: false,
            },
            lookupSnapshot: {
              current: 204,
              open: 200,
              high: 205,
              low: 195,
              close: 204,
              volume: 1_000,
            },
          },
        },
      ],
      enabled: false,
    });
  });

  it('fires exactly once on a qualifying CandleEvent for `Once × VolumeValue` and auto-disables', async () => {
    const driver = buildDriver(onceRule('volume-once', OperandKind.VolumeValue, 500));

    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(1000, { open: 200, high: 205, low: 195, close: 204, volume: 1_000 }),
      final: false,
    });
    await driver.wired.drain();

    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(2000, { open: 300, high: 305, low: 295, close: 304, volume: 1_100 }),
      final: false,
    });
    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(3000, { open: 400, high: 405, low: 395, close: 404, volume: 1_200 }),
      final: false,
    });
    await driver.wired.drain();

    const fired = (await driver.eventLog.ruleEvents('volume-once')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    const stored = await driver.rules.get('volume-once');
    expect({ notified: driver.notifier.sent, fired, enabled: stored?.enabled }).toEqual({
      notified: [{ destinationName: 'main', body: 'volume-once' }],
      fired: [
        {
          type: RuleEventType.Fired,
          ts: 1000,
          ruleId: 'volume-once',
          symbolId: SYMBOL_ID,
          firedAt: 999,
          context: {
            inboundEvent: {
              kind: RuleEventKind.OpenValueChanged,
              ts: 1000,
              symbolId: SYMBOL_ID,
              prev: null,
              current: 200,
              final: false,
            },
            lookupSnapshot: {
              current: 204,
              open: 200,
              high: 205,
              low: 195,
              close: 204,
              volume: 1_000,
            },
          },
        },
      ],
      enabled: false,
    });
  });
});
