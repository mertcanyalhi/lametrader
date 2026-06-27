import {
  ActionKind,
  ConditionNodeKind,
  type EquityCandle,
  NumericOperator,
  OperandKind,
  Period,
  type Rule,
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
 * E2e for #319 — covers the three crossing operators
 * (`Crossing` / `CrossingUp` / `CrossingDown`) end-to-end through the
 * `QuoteRuleEventBridge` and `CandleRuleEventBridge`, both of which
 * maintain per-symbol prev caches that feed the operator's prev→current
 * axis.
 *
 * The crossing operators only fire on a real transition: a single tick
 * with no prior observation returns `false` (the bridge fills `prev =
 * null` on first observation, which short-circuits the evaluator). The
 * suite asserts both the firing cases and these silent-on-no-transition
 * cases, and exercises both bridge variants per the parent issue's
 * "confirms bridge prev cache propagation" requirement.
 */

const SYMBOL_ID = 'stock:AAPL';
const PROFILE_ID = 'profile-1';

function rule(
  id: string,
  operator: NumericOperator,
  operand:
    | OperandKind.CurrentValue
    | OperandKind.OpenValue
    | OperandKind.HighValue
    | OperandKind.LowValue
    | OperandKind.CloseValue
    | OperandKind.VolumeValue = OperandKind.CurrentValue,
  threshold = 100,
): Rule {
  return {
    id,
    profileId: PROFILE_ID,
    name: id,
    scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
    condition: {
      kind: ConditionNodeKind.Leaf,
      left: { kind: operand, valueType: StateValueType.Number },
      operator,
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

async function pushPriceSeries(
  driver: ReturnType<typeof buildDriver>,
  prices: number[],
): Promise<void> {
  for (const [i, price] of prices.entries()) {
    driver.wired.quoteBridge.handleQuote({
      subscriptionId: 's',
      id: SYMBOL_ID,
      period: Period.OneMinute,
      quote: { price, change: 0, changePct: 0, time: (i + 1) * 1_000 },
      final: false,
    });
    await driver.wired.drain();
  }
}

async function fireCount(driver: ReturnType<typeof buildDriver>, ruleId: string): Promise<number> {
  const events = await driver.eventLog.ruleEvents(ruleId);
  return events.filter((event) => event.type === RuleEventType.Fired).length;
}

describe('crossing operators (e2e)', () => {
  it('`CrossingUp 100` fires once on the upward transition tick of [99, 101]', async () => {
    const driver = buildDriver(rule('cu-up', NumericOperator.CrossingUp));

    await pushPriceSeries(driver, [99, 101]);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'cu-up'),
      enabled: (await driver.rules.get('cu-up'))?.enabled,
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'cu-up' }],
      fires: 1,
      enabled: false,
    });
  });

  it('`CrossingUp 100` is silent on [101, 99] (downward) — no fires', async () => {
    const driver = buildDriver(rule('cu-down', NumericOperator.CrossingUp));

    await pushPriceSeries(driver, [101, 99]);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'cu-down'),
    }).toEqual({ notified: [], fires: 0 });
  });

  it('`CrossingUp 100` is silent on a single qualifying tick — no prior observation, no fire', async () => {
    const driver = buildDriver(rule('cu-seed', NumericOperator.CrossingUp));

    await pushPriceSeries(driver, [101]);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'cu-seed'),
    }).toEqual({ notified: [], fires: 0 });
  });

  it('`CrossingDown 100` fires once on the downward transition tick of [101, 99]', async () => {
    const driver = buildDriver(rule('cd-down', NumericOperator.CrossingDown));

    await pushPriceSeries(driver, [101, 99]);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'cd-down'),
      enabled: (await driver.rules.get('cd-down'))?.enabled,
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'cd-down' }],
      fires: 1,
      enabled: false,
    });
  });

  it('`CrossingDown 100` is silent on [99, 101] (upward) — no fires', async () => {
    const driver = buildDriver(rule('cd-up', NumericOperator.CrossingDown));

    await pushPriceSeries(driver, [99, 101]);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'cd-up'),
    }).toEqual({ notified: [], fires: 0 });
  });

  it('`CrossingDown 100` is silent on a single qualifying tick — no prior observation, no fire', async () => {
    const driver = buildDriver(rule('cd-seed', NumericOperator.CrossingDown));

    await pushPriceSeries(driver, [99]);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'cd-seed'),
    }).toEqual({ notified: [], fires: 0 });
  });

  it('`Crossing 100` (direction-agnostic) fires on the upward transition of [99, 101]', async () => {
    const driver = buildDriver(rule('c-up', NumericOperator.Crossing));

    await pushPriceSeries(driver, [99, 101]);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'c-up'),
      enabled: (await driver.rules.get('c-up'))?.enabled,
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'c-up' }],
      fires: 1,
      enabled: false,
    });
  });

  it('`Crossing 100` (direction-agnostic) fires on the downward transition of [101, 99]', async () => {
    const driver = buildDriver(rule('c-down', NumericOperator.Crossing));

    await pushPriceSeries(driver, [101, 99]);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'c-down'),
      enabled: (await driver.rules.get('c-down'))?.enabled,
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'c-down' }],
      fires: 1,
      enabled: false,
    });
  });

  it('`Crossing 100` is silent on [99, 99] — no transition across the threshold', async () => {
    const driver = buildDriver(rule('c-still', NumericOperator.Crossing));

    await pushPriceSeries(driver, [99, 99]);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'c-still'),
    }).toEqual({ notified: [], fires: 0 });
  });

  it('`Crossing 100` is silent on a single seed tick — no prior observation, no fire', async () => {
    const driver = buildDriver(rule('c-seed', NumericOperator.Crossing));

    await pushPriceSeries(driver, [99]);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'c-seed'),
    }).toEqual({ notified: [], fires: 0 });
  });

  it('`CrossingUp 100` fires when prev is exactly at the boundary (`[100, 101]`)', async () => {
    const driver = buildDriver(rule('cu-boundary', NumericOperator.CrossingUp));

    await pushPriceSeries(driver, [100, 101]);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'cu-boundary'),
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'cu-boundary' }],
      fires: 1,
    });
  });

  it('`CrossingDown 100` fires when prev is exactly at the boundary (`[100, 99]`)', async () => {
    const driver = buildDriver(rule('cd-boundary', NumericOperator.CrossingDown));

    await pushPriceSeries(driver, [100, 99]);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'cd-boundary'),
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'cd-boundary' }],
      fires: 1,
    });
  });

  it('`CrossingUp 100 × CloseValue` fires via the `CandleRuleEventBridge` prev cache on [c1(close=99), c2(close=101)]', async () => {
    const driver = buildDriver(
      rule('cu-close', NumericOperator.CrossingUp, OperandKind.CloseValue),
    );

    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(1_000, { open: 95, high: 100, low: 90, close: 99, volume: 1_000 }),
      final: false,
    });
    await driver.wired.drain();
    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(2_000, { open: 99, high: 105, low: 98, close: 101, volume: 1_100 }),
      final: false,
    });
    await driver.wired.drain();

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'cu-close'),
      enabled: (await driver.rules.get('cu-close'))?.enabled,
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'cu-close' }],
      fires: 1,
      enabled: false,
    });
  });

  it('`CrossingDown 100 × CloseValue` fires via the `CandleRuleEventBridge` prev cache on [c1(close=101), c2(close=99)]', async () => {
    const driver = buildDriver(
      rule('cd-close', NumericOperator.CrossingDown, OperandKind.CloseValue),
    );

    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(1_000, { open: 99, high: 105, low: 98, close: 101, volume: 1_000 }),
      final: false,
    });
    await driver.wired.drain();
    driver.wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(2_000, { open: 95, high: 100, low: 90, close: 99, volume: 1_100 }),
      final: false,
    });
    await driver.wired.drain();

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'cd-close'),
      enabled: (await driver.rules.get('cd-close'))?.enabled,
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'cd-close' }],
      fires: 1,
      enabled: false,
    });
  });
});
