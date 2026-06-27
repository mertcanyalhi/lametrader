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
 * E2e for #316 — covers `OncePerBarClose(period)` against every relevant
 * inbound OHLCV operand kind on the 1-minute period, plus period-awareness
 * on the 5-minute period and a `final: false` negative case.
 *
 * The trigger gates first on the event's `final` flag (forming bars are
 * suppressed regardless of condition) then on the per-`(symbolId)` bar
 * boundary derived from `event.ts` and `period`. Tests drive both
 * intra-bar forming candles (`final: false`) and final-tick candles
 * (`final: true`) through the real `CandleRuleEventBridge` →
 * `RuleOrchestrator` chain.
 *
 * `OncePerBarClose` is OHLCV-only — the `CurrentValue` cell is out of
 * scope per the parent issue (`SymbolQuoteEvent` doesn't carry a
 * bar-final flag).
 */

const SYMBOL_ID = 'stock:AAPL';
const PROFILE_ID = 'profile-1';

type OhlcvOperand =
  | OperandKind.OpenValue
  | OperandKind.HighValue
  | OperandKind.LowValue
  | OperandKind.CloseValue
  | OperandKind.VolumeValue;

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

describe('OncePerBarClose trigger × OHLCV operand matrix (e2e)', () => {
  it('fires only on the bar-final candle for `OncePerBarClose(1m) × OpenValue`', async () => {
    await runFinalGateTest(OperandKind.OpenValue, 'open-once-per-bar-close');
  });

  it('fires only on the bar-final candle for `OncePerBarClose(1m) × HighValue`', async () => {
    await runFinalGateTest(OperandKind.HighValue, 'high-once-per-bar-close');
  });

  it('fires only on the bar-final candle for `OncePerBarClose(1m) × LowValue`', async () => {
    await runFinalGateTest(OperandKind.LowValue, 'low-once-per-bar-close');
  });

  it('fires only on the bar-final candle for `OncePerBarClose(1m) × CloseValue`', async () => {
    await runFinalGateTest(OperandKind.CloseValue, 'close-once-per-bar-close');
  });

  it('fires only on the bar-final candle for `OncePerBarClose(1m) × VolumeValue`', async () => {
    await runFinalGateTest(OperandKind.VolumeValue, 'volume-once-per-bar-close', 500);
  });

  it('honours the 5m period for `OncePerBarClose(5m) × CloseValue` — only one fire per 5m bucket', async () => {
    const driver = buildDriver(
      makeRule('close-once-per-5m-bar-close', OperandKind.CloseValue, 50, {
        kind: TriggerKind.OncePerBarClose,
        period: Period.FiveMinutes,
      }),
    );

    // 5m bucket 1 (0–299_999): six 1m-final candles. The first fires on the
    // bucket boundary; the next four within the same 5m bucket are gated.
    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(0, { open: 100, high: 105, low: 95, close: 104, volume: 1_000 }),
      final: true,
    });
    await driver.wired.drain();
    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(60_000, { open: 110, high: 115, low: 105, close: 114, volume: 1_100 }),
      final: true,
    });
    await driver.wired.drain();
    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(120_000, { open: 120, high: 125, low: 115, close: 124, volume: 1_200 }),
      final: true,
    });
    await driver.wired.drain();
    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(180_000, { open: 130, high: 135, low: 125, close: 134, volume: 1_300 }),
      final: true,
    });
    await driver.wired.drain();
    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(240_000, { open: 140, high: 145, low: 135, close: 144, volume: 1_400 }),
      final: true,
    });
    await driver.wired.drain();

    // 5m bucket 2 (300_000–): refires on the new bucket's first final tick.
    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(300_000, { open: 200, high: 205, low: 195, close: 204, volume: 1_500 }),
      final: true,
    });
    await driver.wired.drain();

    const fired = (await driver.eventLog.ruleEvents('close-once-per-5m-bar-close')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    expect({ notified: driver.notifier.sent, fired }).toEqual({
      notified: [
        { destinationName: 'main', body: 'close-once-per-5m-bar-close' },
        { destinationName: 'main', body: 'close-once-per-5m-bar-close' },
      ],
      fired: [
        {
          type: RuleEventType.Fired,
          ts: 0,
          ruleId: 'close-once-per-5m-bar-close',
          symbolId: SYMBOL_ID,
          firedAt: 999,
          context: {
            inboundEvent: {
              kind: RuleEventKind.OpenValueChanged,
              ts: 0,
              symbolId: SYMBOL_ID,
              prev: null,
              current: 100,
              final: true,
            },
            lookupSnapshot: {
              current: 104,
              open: 100,
              high: 105,
              low: 95,
              close: 104,
              volume: 1_000,
            },
          },
        },
        {
          type: RuleEventType.Fired,
          ts: 300_000,
          ruleId: 'close-once-per-5m-bar-close',
          symbolId: SYMBOL_ID,
          firedAt: 999,
          context: {
            inboundEvent: {
              kind: RuleEventKind.OpenValueChanged,
              ts: 300_000,
              symbolId: SYMBOL_ID,
              prev: 140,
              current: 200,
              final: true,
            },
            lookupSnapshot: {
              current: 204,
              open: 200,
              high: 205,
              low: 195,
              close: 204,
              volume: 1_500,
            },
          },
        },
      ],
    });
  });

  it('does not fire when the condition holds but every event arrives `final: false`', async () => {
    const driver = buildDriver(
      makeRule('forming-only', OperandKind.CloseValue, 50, {
        kind: TriggerKind.OncePerBarClose,
        period: Period.OneMinute,
      }),
    );

    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(60_000, { open: 100, high: 105, low: 95, close: 200, volume: 1_000 }),
      final: false,
    });
    await driver.wired.drain();
    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(120_000, { open: 110, high: 115, low: 105, close: 210, volume: 1_100 }),
      final: false,
    });
    await driver.wired.drain();
    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(180_000, { open: 120, high: 125, low: 115, close: 220, volume: 1_200 }),
      final: false,
    });
    await driver.wired.drain();

    const fired = (await driver.eventLog.ruleEvents('forming-only')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    expect({ notified: driver.notifier.sent, fired }).toEqual({
      notified: [],
      fired: [],
    });
  });
});

/**
 * Shared OncePerBarClose(1m) helper used by the five OHLCV operand tests.
 * Drives four `final: false` forming candles in 1m bar 1 (`ts=60_000`)
 * with qualifying values, then one `final: true` candle in the same bar.
 * Asserts exactly one fire on the final candle's Open event (the bridge's
 * first emitted axis); the four forming candles produce zero fires because
 * the `OncePerBarClose` gate suppresses `final: false` regardless of bar
 * boundary or condition.
 */
async function runFinalGateTest(
  operand: OhlcvOperand,
  ruleId: string,
  threshold = 100,
): Promise<void> {
  const driver = buildDriver(
    makeRule(ruleId, operand, threshold, {
      kind: TriggerKind.OncePerBarClose,
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
    candle: candle(60_000, { open: 201, high: 210, low: 190, close: 208, volume: 1_100 }),
    final: false,
  });
  await driver.wired.drain();
  driver.wired.candleBridge.handleCandle({
    id: SYMBOL_ID,
    period: Period.OneMinute,
    candle: candle(60_000, { open: 202, high: 215, low: 185, close: 212, volume: 1_200 }),
    final: false,
  });
  await driver.wired.drain();
  driver.wired.candleBridge.handleCandle({
    id: SYMBOL_ID,
    period: Period.OneMinute,
    candle: candle(60_000, { open: 203, high: 220, low: 180, close: 216, volume: 1_300 }),
    final: false,
  });
  await driver.wired.drain();

  driver.wired.candleBridge.handleCandle({
    id: SYMBOL_ID,
    period: Period.OneMinute,
    candle: candle(60_000, { open: 204, high: 225, low: 175, close: 220, volume: 1_400 }),
    final: true,
  });
  await driver.wired.drain();

  const fired = (await driver.eventLog.ruleEvents(ruleId)).filter(
    (event) => event.type === RuleEventType.Fired,
  );
  expect({ notified: driver.notifier.sent, fired }).toEqual({
    notified: [{ destinationName: 'main', body: ruleId }],
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
            prev: 203,
            current: 204,
            final: true,
          },
          lookupSnapshot: {
            current: 220,
            open: 204,
            high: 225,
            low: 175,
            close: 220,
            volume: 1_400,
          },
        },
      },
    ],
  });
}
