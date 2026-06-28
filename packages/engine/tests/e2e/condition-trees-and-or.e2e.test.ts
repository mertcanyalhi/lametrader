import {
  ActionKind,
  type ConditionNode,
  ConditionNodeKind,
  NumericOperator,
  OperandKind,
  Period,
  type Rule,
  RuleEventType,
  RuleScopeKind,
  StateOperator,
  StateValueType,
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
 * E2e for #321 — covers `ConditionNodeKind.And` / `Or` composition,
 * including a nested `Or(And, And)` tree and a short-circuit test, all
 * driven through the real `QuoteRuleEventBridge` → `RuleOrchestrator`
 * chain.
 *
 * Each rule uses `Once × NotifyTelegram` so a fire is observed via the
 * notifier and the auto-disable; the test pushes a sequence of quotes
 * (and optionally pre-seeds `state.signal`) and asserts the rule fired
 * (or did not).
 */

const SYMBOL_ID = 'stock:AAPL';
const PROFILE_ID = 'profile-1';

const BUY = { type: StateValueType.Enum as const, value: 'BUY' };
const SELL = { type: StateValueType.Enum as const, value: 'SELL' };

const priceGt = (threshold: number): ConditionNode => ({
  kind: ConditionNodeKind.Leaf,
  left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
  operator: NumericOperator.Gt,
  right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: threshold } },
});

const priceLt = (threshold: number): ConditionNode => ({
  kind: ConditionNodeKind.Leaf,
  left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
  operator: NumericOperator.Lt,
  right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: threshold } },
});

const signalEquals = (value: { type: StateValueType.Enum; value: string }): ConditionNode => ({
  kind: ConditionNodeKind.Leaf,
  left: { kind: OperandKind.SymbolStateRef, key: 'signal', valueType: StateValueType.Enum },
  operator: StateOperator.Equals,
  right: { kind: OperandKind.Literal, value },
});

function rule(id: string, condition: ConditionNode): Rule {
  return {
    id,
    profileId: PROFILE_ID,
    name: id,
    scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
    condition,
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

function buildDriver(seedRule: Rule) {
  const rules = new InMemoryRuleRepository([seedRule]);
  const watchlist = new InMemoryWatchlistRepository();
  const state = new InMemoryStateRepository();
  const notifier = new InMemoryNotifier(['main']);
  const eventLog = new InMemoryEventLog(() => 999);
  const firingState = new InMemoryFiringStateRepository();
  const wired = wireRuleEngine({ rules, watchlist, state, notifier, eventLog, firingState });
  return { rules, state, notifier, eventLog, wired };
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

async function fireCount(driver: ReturnType<typeof buildDriver>, ruleId: string): Promise<number> {
  const events = await driver.eventLog.ruleEvents(ruleId);
  return events.filter((event) => event.type === RuleEventType.Fired).length;
}

describe('condition trees And/Or (e2e)', () => {
  it('`And(price > 100, price < 200)` fires on a price inside the open range', async () => {
    const driver = buildDriver(
      rule('and-range-in', {
        kind: ConditionNodeKind.And,
        children: [priceGt(100), priceLt(200)],
      }),
    );

    await pushQuote(driver, 150, 1_000);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'and-range-in'),
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'and-range-in' }],
      fires: 1,
    });
  });

  it('`And(price > 100, price < 200)` is silent for a price below the range', async () => {
    const driver = buildDriver(
      rule('and-range-low', {
        kind: ConditionNodeKind.And,
        children: [priceGt(100), priceLt(200)],
      }),
    );

    await pushQuote(driver, 50, 1_000);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'and-range-low'),
    }).toEqual({ notified: [], fires: 0 });
  });

  it('`And(price > 100, price < 200)` is silent for a price above the range', async () => {
    const driver = buildDriver(
      rule('and-range-high', {
        kind: ConditionNodeKind.And,
        children: [priceGt(100), priceLt(200)],
      }),
    );

    await pushQuote(driver, 250, 1_000);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'and-range-high'),
    }).toEqual({ notified: [], fires: 0 });
  });

  it('`Or(price < 100, price > 200)` fires on a price below the low gate', async () => {
    const driver = buildDriver(
      rule('or-low', {
        kind: ConditionNodeKind.Or,
        children: [priceLt(100), priceGt(200)],
      }),
    );

    await pushQuote(driver, 50, 1_000);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'or-low'),
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'or-low' }],
      fires: 1,
    });
  });

  it('`Or(price < 100, price > 200)` fires on a price above the high gate', async () => {
    const driver = buildDriver(
      rule('or-high', {
        kind: ConditionNodeKind.Or,
        children: [priceLt(100), priceGt(200)],
      }),
    );

    await pushQuote(driver, 250, 1_000);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'or-high'),
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'or-high' }],
      fires: 1,
    });
  });

  it('`Or(price < 100, price > 200)` is silent for a price between the gates', async () => {
    const driver = buildDriver(
      rule('or-mid', {
        kind: ConditionNodeKind.Or,
        children: [priceLt(100), priceGt(200)],
      }),
    );

    await pushQuote(driver, 150, 1_000);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'or-mid'),
    }).toEqual({ notified: [], fires: 0 });
  });

  it('`And(price > 100, signal == BUY)` fires when both branches are true', async () => {
    const driver = buildDriver(
      rule('mix-both', {
        kind: ConditionNodeKind.And,
        children: [priceGt(100), signalEquals(BUY)],
      }),
    );

    await driver.state.setSymbolState(PROFILE_ID, SYMBOL_ID, 'signal', BUY, 0);
    await pushQuote(driver, 150, 1_000);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'mix-both'),
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'mix-both' }],
      fires: 1,
    });
  });

  it('`And(price > 100, signal == BUY)` is silent when `state.signal` is missing', async () => {
    const driver = buildDriver(
      rule('mix-no-signal', {
        kind: ConditionNodeKind.And,
        children: [priceGt(100), signalEquals(BUY)],
      }),
    );

    // No pre-seed — `lookups.getSymbolState` returns null; the state
    // operator falls through to `false`.
    await pushQuote(driver, 150, 1_000);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'mix-no-signal'),
    }).toEqual({ notified: [], fires: 0 });
  });

  it('`And(price > 100, signal == BUY)` is silent when only the state branch is true', async () => {
    const driver = buildDriver(
      rule('mix-state-only', {
        kind: ConditionNodeKind.And,
        children: [priceGt(100), signalEquals(BUY)],
      }),
    );

    await driver.state.setSymbolState(PROFILE_ID, SYMBOL_ID, 'signal', BUY, 0);
    await pushQuote(driver, 50, 1_000);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'mix-state-only'),
    }).toEqual({ notified: [], fires: 0 });
  });

  it('nested `Or(And(price > 100, signal == BUY), And(price < 50, signal == SELL))` fires when the first pair matches', async () => {
    const driver = buildDriver(
      rule('nested-buy', {
        kind: ConditionNodeKind.Or,
        children: [
          { kind: ConditionNodeKind.And, children: [priceGt(100), signalEquals(BUY)] },
          { kind: ConditionNodeKind.And, children: [priceLt(50), signalEquals(SELL)] },
        ],
      }),
    );

    await driver.state.setSymbolState(PROFILE_ID, SYMBOL_ID, 'signal', BUY, 0);
    await pushQuote(driver, 150, 1_000);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'nested-buy'),
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'nested-buy' }],
      fires: 1,
    });
  });

  it('nested `Or(And(price > 100, signal == BUY), And(price < 50, signal == SELL))` fires when the second pair matches', async () => {
    const driver = buildDriver(
      rule('nested-sell', {
        kind: ConditionNodeKind.Or,
        children: [
          { kind: ConditionNodeKind.And, children: [priceGt(100), signalEquals(BUY)] },
          { kind: ConditionNodeKind.And, children: [priceLt(50), signalEquals(SELL)] },
        ],
      }),
    );

    await driver.state.setSymbolState(PROFILE_ID, SYMBOL_ID, 'signal', SELL, 0);
    await pushQuote(driver, 25, 1_000);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'nested-sell'),
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'nested-sell' }],
      fires: 1,
    });
  });

  it('nested `Or(And(price > 100, signal == BUY), And(price < 50, signal == SELL))` is silent for a cross-matched pair (`price=150, signal=SELL`)', async () => {
    const driver = buildDriver(
      rule('nested-cross', {
        kind: ConditionNodeKind.Or,
        children: [
          { kind: ConditionNodeKind.And, children: [priceGt(100), signalEquals(BUY)] },
          { kind: ConditionNodeKind.And, children: [priceLt(50), signalEquals(SELL)] },
        ],
      }),
    );

    await driver.state.setSymbolState(PROFILE_ID, SYMBOL_ID, 'signal', SELL, 0);
    await pushQuote(driver, 150, 1_000);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'nested-cross'),
    }).toEqual({ notified: [], fires: 0 });
  });

  it('`And` short-circuits — a false left side keeps a state-ref right side from observably failing on a missing key', async () => {
    const driver = buildDriver(
      rule('short-circuit', {
        kind: ConditionNodeKind.And,
        children: [priceLt(0), signalEquals(BUY)],
      }),
    );

    // `state.signal` is never set — the right operand's lookup would
    // resolve to `null`. But the left operand (`price < 0`) is false
    // for every non-negative quote, so `And` short-circuits and the rule
    // simply never fires (and never errors).
    await pushQuote(driver, 150, 1_000);
    await pushQuote(driver, 100, 2_000);
    await pushQuote(driver, 50, 3_000);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'short-circuit'),
    }).toEqual({ notified: [], fires: 0 });
  });
});
