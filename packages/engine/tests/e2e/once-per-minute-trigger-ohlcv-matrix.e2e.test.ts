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
 * E2e for #317 — covers `OncePerMinute(intervalMs)` against every relevant
 * operand kind plus a short-interval test and an interval-suppression
 * negative case.
 *
 * The gate is *edge-triggered* (fires on the false→true transition) and
 * *interval-suppressed* (no refire within `intervalMs` of the previous
 * fire). To get a second fire each test inserts one non-qualifying event
 * to flip the firing-state latch to inactive, then a qualifying event at
 * or past the interval boundary.
 */

const SYMBOL_ID = 'stock:AAPL';
const PROFILE_ID = 'profile-1';

type OperandCell =
  | OperandKind.CurrentValue
  | OperandKind.OpenValue
  | OperandKind.HighValue
  | OperandKind.LowValue
  | OperandKind.CloseValue
  | OperandKind.VolumeValue;

function makeRule(id: string, operand: OperandCell, threshold: number, trigger: Trigger): Rule {
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

async function pushQuote(
  driver: ReturnType<typeof buildDriver>,
  price: number,
  time: number,
): Promise<void> {
  driver.wired.quoteBridge.handleQuote({
    subscriptionId: 's',
    id: SYMBOL_ID,
    period: Period.OneMinute,
    quote: { price, change: 0, changePct: 0, time },
    final: false,
  });
  await driver.wired.drain();
}

async function pushCandle(
  driver: ReturnType<typeof buildDriver>,
  time: number,
  axes: { open: number; high: number; low: number; close: number; volume: number },
): Promise<void> {
  driver.wired.candleBridge.handleCandle({
    id: SYMBOL_ID,
    period: Period.OneMinute,
    candle: candle(time, axes),
    final: false,
  });
  await driver.wired.drain();
}

describe('OncePerMinute trigger × OHLCV operand matrix (e2e)', () => {
  it('latches for `intervalMs` for `OncePerMinute(60_000) × CurrentValue` — fires at t=0, suppresses, refires at t=60_000 after the latch flips', async () => {
    const driver = buildDriver(
      makeRule('current-once-per-minute', OperandKind.CurrentValue, 100, {
        kind: TriggerKind.OncePerMinute,
        intervalMs: 60_000,
      }),
    );

    await pushQuote(driver, 150, 0);
    await pushQuote(driver, 160, 15_000);
    await pushQuote(driver, 170, 30_000);
    await pushQuote(driver, 180, 59_000);
    await pushQuote(driver, 50, 59_500);
    await pushQuote(driver, 190, 60_000);

    const fired = (await driver.eventLog.ruleEvents('current-once-per-minute')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    expect({ notified: driver.notifier.sent, fired }).toEqual({
      notified: [
        { destinationName: 'main', body: 'current-once-per-minute' },
        { destinationName: 'main', body: 'current-once-per-minute' },
      ],
      fired: [
        {
          type: RuleEventType.Fired,
          ts: 0,
          ruleId: 'current-once-per-minute',
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
          ts: 60_000,
          ruleId: 'current-once-per-minute',
          symbolId: SYMBOL_ID,
          firedAt: 999,
          context: {
            inboundEvent: {
              kind: RuleEventKind.CurrentValueChanged,
              ts: 60_000,
              symbolId: SYMBOL_ID,
              prev: 50,
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

  it('latches for `intervalMs` for `OncePerMinute(60_000) × OpenValue`', async () => {
    await runCandleOhlcvTest(OperandKind.OpenValue, 'open-once-per-minute');
  });

  it('latches for `intervalMs` for `OncePerMinute(60_000) × HighValue`', async () => {
    await runCandleOhlcvTest(OperandKind.HighValue, 'high-once-per-minute');
  });

  it('latches for `intervalMs` for `OncePerMinute(60_000) × LowValue`', async () => {
    await runCandleOhlcvTest(OperandKind.LowValue, 'low-once-per-minute');
  });

  it('latches for `intervalMs` for `OncePerMinute(60_000) × CloseValue`', async () => {
    await runCandleOhlcvTest(OperandKind.CloseValue, 'close-once-per-minute');
  });

  it('latches for `intervalMs` for `OncePerMinute(60_000) × VolumeValue`', async () => {
    await runCandleOhlcvTest(OperandKind.VolumeValue, 'volume-once-per-minute', 500);
  });

  it('honours the rule-supplied `intervalMs=5_000` rather than a hard-coded minute', async () => {
    const driver = buildDriver(
      makeRule('current-once-per-5s', OperandKind.CurrentValue, 100, {
        kind: TriggerKind.OncePerMinute,
        intervalMs: 5_000,
      }),
    );

    await pushQuote(driver, 150, 0);
    await pushQuote(driver, 160, 1_000);
    await pushQuote(driver, 170, 2_000);
    await pushQuote(driver, 180, 3_000);
    await pushQuote(driver, 190, 4_000);
    await pushQuote(driver, 50, 4_500);
    await pushQuote(driver, 200, 5_000);

    const fired = (await driver.eventLog.ruleEvents('current-once-per-5s')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    expect({ notified: driver.notifier.sent, fired }).toEqual({
      notified: [
        { destinationName: 'main', body: 'current-once-per-5s' },
        { destinationName: 'main', body: 'current-once-per-5s' },
      ],
      fired: [
        {
          type: RuleEventType.Fired,
          ts: 0,
          ruleId: 'current-once-per-5s',
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
          ts: 5_000,
          ruleId: 'current-once-per-5s',
          symbolId: SYMBOL_ID,
          firedAt: 999,
          context: {
            inboundEvent: {
              kind: RuleEventKind.CurrentValueChanged,
              ts: 5_000,
              symbolId: SYMBOL_ID,
              prev: 50,
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

  it('suppresses a false→true transition that lands inside the latch window and fires the first transition past it', async () => {
    const driver = buildDriver(
      makeRule('latch-window', OperandKind.CurrentValue, 100, {
        kind: TriggerKind.OncePerMinute,
        intervalMs: 60_000,
      }),
    );

    // First fire at t=0 — establishes the latch.
    await pushQuote(driver, 150, 0);
    // Drop below threshold (latch state flips false), still inside the
    // suppression window.
    await pushQuote(driver, 50, 30_000);
    // Re-cross above threshold inside the suppression window — gated by
    // `currentTs - lastFire < intervalMs` (40_000 < 60_000).
    await pushQuote(driver, 160, 40_000);
    // Drop below threshold again past the suppression window.
    await pushQuote(driver, 50, 70_000);
    // Re-cross past the suppression window — fires.
    await pushQuote(driver, 170, 80_000);

    const fired = (await driver.eventLog.ruleEvents('latch-window')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    expect({ notified: driver.notifier.sent, fired }).toEqual({
      notified: [
        { destinationName: 'main', body: 'latch-window' },
        { destinationName: 'main', body: 'latch-window' },
      ],
      fired: [
        {
          type: RuleEventType.Fired,
          ts: 0,
          ruleId: 'latch-window',
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
          ts: 80_000,
          ruleId: 'latch-window',
          symbolId: SYMBOL_ID,
          firedAt: 999,
          context: {
            inboundEvent: {
              kind: RuleEventKind.CurrentValueChanged,
              ts: 80_000,
              symbolId: SYMBOL_ID,
              prev: 50,
              current: 170,
              final: false,
            },
            lookupSnapshot: {
              current: 170,
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
});

/**
 * Shared candle-driven OncePerMinute(60_000) helper used by the five OHLCV
 * operand tests. Drives:
 *
 *  - one qualifying candle at `t=0` — fires;
 *  - three more qualifying candles at intra-window timestamps — gated by
 *    the active-state latch;
 *  - one non-qualifying candle just before the window boundary to flip the
 *    latch to inactive;
 *  - one qualifying candle exactly at `t=60_000` — refires.
 *
 * The candle bridge's synchronous fanout puts every OHLCV axis into the
 * `LiveEvaluationLookups` *before* the orchestrator processes the first
 * emitted event, so every OHLCV-axis rule fires on the bar's `OpenValueChanged`.
 */
async function runCandleOhlcvTest(
  operand: OperandCell,
  ruleId: string,
  threshold = 100,
): Promise<void> {
  const driver = buildDriver(
    makeRule(ruleId, operand, threshold, {
      kind: TriggerKind.OncePerMinute,
      intervalMs: 60_000,
    }),
  );

  await pushCandle(driver, 0, { open: 200, high: 205, low: 195, close: 204, volume: 1_000 });
  await pushCandle(driver, 15_000, { open: 210, high: 215, low: 205, close: 214, volume: 1_100 });
  await pushCandle(driver, 30_000, { open: 220, high: 225, low: 215, close: 224, volume: 1_200 });
  await pushCandle(driver, 59_000, { open: 230, high: 235, low: 225, close: 234, volume: 1_300 });
  // Non-qualifying — flips the active latch to false so the next qualifying
  // event can re-trigger the false→true edge.
  await pushCandle(driver, 59_500, { open: 50, high: 55, low: 45, close: 52, volume: 70 });
  await pushCandle(driver, 60_000, { open: 300, high: 305, low: 295, close: 304, volume: 1_500 });

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
        ts: 0,
        ruleId,
        symbolId: SYMBOL_ID,
        firedAt: 999,
        context: {
          inboundEvent: {
            kind: RuleEventKind.OpenValueChanged,
            ts: 0,
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
        ts: 60_000,
        ruleId,
        symbolId: SYMBOL_ID,
        firedAt: 999,
        context: {
          inboundEvent: {
            kind: RuleEventKind.OpenValueChanged,
            ts: 60_000,
            symbolId: SYMBOL_ID,
            prev: 50,
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
