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
  type Trigger,
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
 * E2e for #315 — covers the `OncePerBar(period)` trigger against every
 * inbound OHLCV operand kind on the 1-minute period, plus period-awareness
 * on the 5-minute period and a condition-false negative case.
 *
 * Drives `SymbolQuoteEvent`s and `CandleEvent`s through the real bridges
 * into a real `RuleOrchestrator` wired against in-memory adapters via
 * `wireRuleEngine`. Each test pushes one qualifying input per bar plus
 * additional qualifying inputs *within* the same bar that must not refire,
 * then asserts the full `Fired` payload via `toEqual` with `firedAt`
 * pinned by `InMemoryEventLog(() => 999)`.
 *
 * `OncePerBar` aligns the gate by `Math.floor(event.ts / periodMillis)`, so
 * tests pin candle / quote timestamps to bar boundaries: `60_000` /
 * `120_000` for 1m bars, `0` / `300_000` for 5m bars.
 */

const SYMBOL_ID = 'stock:AAPL';
const PROFILE_ID = 'profile-1';

type OhlcvOperand =
  | OperandKind.CurrentValue
  | OperandKind.OpenValue
  | OperandKind.HighValue
  | OperandKind.LowValue
  | OperandKind.CloseValue
  | OperandKind.VolumeValue;

/**
 * Build a minimally-valid rule on the matrix's symbol with a
 * `<operand> > threshold` condition, the given trigger, and one telegram
 * action.
 */
function makeRule(id: string, operand: OhlcvOperand, threshold: number, trigger: Trigger): Rule {
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
    trigger,
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

function candle(
  time: number,
  axes: { open: number; high: number; low: number; close: number; volume: number },
): EquityCandle {
  return { type: SymbolType.Stock, time, ...axes };
}

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

describe('OncePerBar trigger × OHLCV operand matrix (e2e)', () => {
  it('fires once per 1m bar for `OncePerBar(1m) × CurrentValue`, refires on the next bar', async () => {
    const driver = buildDriver(
      makeRule('current-once-per-bar', OperandKind.CurrentValue, 100, {
        kind: TriggerKind.OncePerBar,
        period: Period.OneMinute,
      }),
    );

    // Bar 1 (60_000–119_999): one qualifying tick fires, three more same-bar
    // ticks are gated.
    driver.wired.quoteBridge.handleQuote({
      subscriptionId: 's',
      id: SYMBOL_ID,
      period: Period.OneMinute,
      quote: { price: 150, change: 0, changePct: 0, time: 60_000 },
      final: false,
    });
    await driver.wired.drain();
    driver.wired.quoteBridge.handleQuote({
      subscriptionId: 's',
      id: SYMBOL_ID,
      period: Period.OneMinute,
      quote: { price: 160, change: 0, changePct: 0, time: 70_000 },
      final: false,
    });
    await driver.wired.drain();
    driver.wired.quoteBridge.handleQuote({
      subscriptionId: 's',
      id: SYMBOL_ID,
      period: Period.OneMinute,
      quote: { price: 170, change: 0, changePct: 0, time: 80_000 },
      final: false,
    });
    await driver.wired.drain();
    driver.wired.quoteBridge.handleQuote({
      subscriptionId: 's',
      id: SYMBOL_ID,
      period: Period.OneMinute,
      quote: { price: 180, change: 0, changePct: 0, time: 90_000 },
      final: false,
    });
    await driver.wired.drain();

    // Bar 2 (120_000–): refires.
    driver.wired.quoteBridge.handleQuote({
      subscriptionId: 's',
      id: SYMBOL_ID,
      period: Period.OneMinute,
      quote: { price: 190, change: 0, changePct: 0, time: 120_000 },
      final: false,
    });
    await driver.wired.drain();

    const fired = (await driver.eventLog.ruleEvents('current-once-per-bar')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    expect({ notified: driver.notifier.sent, fired }).toEqual({
      notified: [
        { destinationName: 'main', body: 'current-once-per-bar' },
        { destinationName: 'main', body: 'current-once-per-bar' },
      ],
      fired: [
        {
          type: RuleEventType.Fired,
          ts: 60_000,
          ruleId: 'current-once-per-bar',
          symbolId: SYMBOL_ID,
          firedAt: 999,
          context: {
            inboundEvent: {
              kind: RuleEventKind.CurrentValueChanged,
              ts: 60_000,
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
        {
          type: RuleEventType.Fired,
          ts: 120_000,
          ruleId: 'current-once-per-bar',
          symbolId: SYMBOL_ID,
          firedAt: 999,
          context: {
            inboundEvent: {
              kind: RuleEventKind.CurrentValueChanged,
              ts: 120_000,
              symbolId: SYMBOL_ID,
              prev: 180,
              current: 190,
              final: false,
            },
            lookupSnapshot: {
              current: 190,
              open: null,
              high: null,
              low: null,
              close: null,
              volume: null,
            },
          },
        },
      ],
    });
  });

  it('fires once per 1m bar for `OncePerBar(1m) × OpenValue`, refires on the next bar', async () => {
    await runCandleOhlcvTest(OperandKind.OpenValue, 'open-once-per-bar');
  });

  it('fires once per 1m bar for `OncePerBar(1m) × HighValue`, refires on the next bar', async () => {
    await runCandleOhlcvTest(OperandKind.HighValue, 'high-once-per-bar');
  });

  it('fires once per 1m bar for `OncePerBar(1m) × LowValue`, refires on the next bar', async () => {
    await runCandleOhlcvTest(OperandKind.LowValue, 'low-once-per-bar');
  });

  it('fires once per 1m bar for `OncePerBar(1m) × CloseValue`, refires on the next bar', async () => {
    await runCandleOhlcvTest(OperandKind.CloseValue, 'close-once-per-bar');
  });

  it('fires once per 1m bar for `OncePerBar(1m) × VolumeValue`, refires on the next bar', async () => {
    await runCandleOhlcvTest(OperandKind.VolumeValue, 'volume-once-per-bar', 500);
  });

  it('honours the 5m period for `OncePerBar(5m) × CurrentValue` — ticks across the bucket fire once', async () => {
    const driver = buildDriver(
      makeRule('current-once-per-5m-bar', OperandKind.CurrentValue, 100, {
        kind: TriggerKind.OncePerBar,
        period: Period.FiveMinutes,
      }),
    );

    // 5m bucket 1 (0–299_999): one fire across five qualifying ticks.
    driver.wired.quoteBridge.handleQuote({
      subscriptionId: 's',
      id: SYMBOL_ID,
      period: Period.OneMinute,
      quote: { price: 150, change: 0, changePct: 0, time: 0 },
      final: false,
    });
    await driver.wired.drain();
    driver.wired.quoteBridge.handleQuote({
      subscriptionId: 's',
      id: SYMBOL_ID,
      period: Period.OneMinute,
      quote: { price: 160, change: 0, changePct: 0, time: 60_000 },
      final: false,
    });
    await driver.wired.drain();
    driver.wired.quoteBridge.handleQuote({
      subscriptionId: 's',
      id: SYMBOL_ID,
      period: Period.OneMinute,
      quote: { price: 170, change: 0, changePct: 0, time: 120_000 },
      final: false,
    });
    await driver.wired.drain();
    driver.wired.quoteBridge.handleQuote({
      subscriptionId: 's',
      id: SYMBOL_ID,
      period: Period.OneMinute,
      quote: { price: 180, change: 0, changePct: 0, time: 180_000 },
      final: false,
    });
    await driver.wired.drain();
    driver.wired.quoteBridge.handleQuote({
      subscriptionId: 's',
      id: SYMBOL_ID,
      period: Period.OneMinute,
      quote: { price: 190, change: 0, changePct: 0, time: 240_000 },
      final: false,
    });
    await driver.wired.drain();

    // 5m bucket 2 (300_000–): refires.
    driver.wired.quoteBridge.handleQuote({
      subscriptionId: 's',
      id: SYMBOL_ID,
      period: Period.OneMinute,
      quote: { price: 200, change: 0, changePct: 0, time: 300_000 },
      final: false,
    });
    await driver.wired.drain();

    const fired = (await driver.eventLog.ruleEvents('current-once-per-5m-bar')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    expect({ notified: driver.notifier.sent, fired }).toEqual({
      notified: [
        { destinationName: 'main', body: 'current-once-per-5m-bar' },
        { destinationName: 'main', body: 'current-once-per-5m-bar' },
      ],
      fired: [
        {
          type: RuleEventType.Fired,
          ts: 0,
          ruleId: 'current-once-per-5m-bar',
          symbolId: SYMBOL_ID,
          firedAt: 999,
          context: {
            inboundEvent: {
              kind: RuleEventKind.CurrentValueChanged,
              ts: 0,
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
        {
          type: RuleEventType.Fired,
          ts: 300_000,
          ruleId: 'current-once-per-5m-bar',
          symbolId: SYMBOL_ID,
          firedAt: 999,
          context: {
            inboundEvent: {
              kind: RuleEventKind.CurrentValueChanged,
              ts: 300_000,
              symbolId: SYMBOL_ID,
              prev: 190,
              current: 200,
              final: false,
            },
            lookupSnapshot: {
              current: 200,
              open: null,
              high: null,
              low: null,
              close: null,
              volume: null,
            },
          },
        },
      ],
    });
  });

  it('does not fire when the condition is false at every bar boundary', async () => {
    const driver = buildDriver(
      makeRule('quiet', OperandKind.CurrentValue, 1_000, {
        kind: TriggerKind.OncePerBar,
        period: Period.OneMinute,
      }),
    );

    driver.wired.quoteBridge.handleQuote({
      subscriptionId: 's',
      id: SYMBOL_ID,
      period: Period.OneMinute,
      quote: { price: 50, change: 0, changePct: 0, time: 60_000 },
      final: false,
    });
    await driver.wired.drain();
    driver.wired.quoteBridge.handleQuote({
      subscriptionId: 's',
      id: SYMBOL_ID,
      period: Period.OneMinute,
      quote: { price: 60, change: 0, changePct: 0, time: 120_000 },
      final: false,
    });
    await driver.wired.drain();
    driver.wired.quoteBridge.handleQuote({
      subscriptionId: 's',
      id: SYMBOL_ID,
      period: Period.OneMinute,
      quote: { price: 70, change: 0, changePct: 0, time: 180_000 },
      final: false,
    });
    await driver.wired.drain();

    const fired = (await driver.eventLog.ruleEvents('quiet')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    expect({ notified: driver.notifier.sent, fired }).toEqual({
      notified: [],
      fired: [],
    });
  });
});

/**
 * Shared candle-driven OncePerBar(1m) helper used by the five OHLCV operand
 * tests. Drives:
 *
 *  - one qualifying candle in 1m bar 1 (`ts=60_000`) — fires;
 *  - two more qualifying candles in the same 1m bar — gated, no refire;
 *  - one qualifying candle in 1m bar 2 (`ts=120_000`) — refires.
 *
 * All OHLCV-axis rules fire on `OpenValueChanged` (the first event the
 * candle bridge emits per bar — see the suite header).
 */
async function runCandleOhlcvTest(
  operand: OhlcvOperand,
  ruleId: string,
  threshold = 100,
): Promise<void> {
  const driver = buildDriver(
    makeRule(ruleId, operand, threshold, {
      kind: TriggerKind.OncePerBar,
      period: Period.OneMinute,
    }),
  );

  driver.wired.candleBridge.handleCandle({
    id: SYMBOL_ID,
    period: Period.OneMinute,
    candle: candle(60_000, { open: 200, high: 205, low: 195, close: 204, volume: 1_000 }),
    final: false,
  });
  await driver.wired.drain();
  driver.wired.candleBridge.handleCandle({
    id: SYMBOL_ID,
    period: Period.OneMinute,
    candle: candle(60_000, { open: 210, high: 215, low: 205, close: 214, volume: 1_100 }),
    final: false,
  });
  await driver.wired.drain();
  driver.wired.candleBridge.handleCandle({
    id: SYMBOL_ID,
    period: Period.OneMinute,
    candle: candle(60_000, { open: 220, high: 225, low: 215, close: 224, volume: 1_200 }),
    final: false,
  });
  await driver.wired.drain();

  driver.wired.candleBridge.handleCandle({
    id: SYMBOL_ID,
    period: Period.OneMinute,
    candle: candle(120_000, { open: 300, high: 305, low: 295, close: 304, volume: 1_500 }),
    final: false,
  });
  await driver.wired.drain();

  const fired = (await driver.eventLog.ruleEvents(ruleId)).filter(
    (event) => event.type === RuleEventType.Fired,
  );
  expect({ notified: driver.notifier.sent, fired }).toEqual({
    notified: [
      { destinationName: 'main', body: ruleId },
      { destinationName: 'main', body: ruleId },
    ],
    fired: [
      {
        type: RuleEventType.Fired,
        ts: 60_000,
        ruleId,
        symbolId: SYMBOL_ID,
        firedAt: 999,
        context: {
          inboundEvent: {
            kind: RuleEventKind.OpenValueChanged,
            ts: 60_000,
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
      {
        type: RuleEventType.Fired,
        ts: 120_000,
        ruleId,
        symbolId: SYMBOL_ID,
        firedAt: 999,
        context: {
          inboundEvent: {
            kind: RuleEventKind.OpenValueChanged,
            ts: 120_000,
            symbolId: SYMBOL_ID,
            prev: 220,
            current: 300,
            final: false,
          },
          lookupSnapshot: {
            current: 304,
            open: 300,
            high: 305,
            low: 295,
            close: 304,
            volume: 1_500,
          },
        },
      },
    ],
  });
}
