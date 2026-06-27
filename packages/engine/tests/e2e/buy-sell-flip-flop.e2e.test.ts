import {
  ActionKind,
  type ConditionNode,
  ConditionNodeKind,
  type EquityCandle,
  NumericOperator,
  OperandKind,
  Period,
  type Rule,
  RuleEventType,
  RuleScopeKind,
  StateOperator,
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
 * E2e for #332 — multi-bar buy/sell flip-flop using a shared `signal`
 * state key. Drives a sequence of five 1m bars whose Open values
 * straddle the threshold and asserts the `signal` state transitions
 * exactly once per direction change.
 */

const SYMBOL_ID = 'crypto:BTCUSDT';
const PROFILE_ID = 'profile-1';
const THRESHOLD = 0.02634;

const BUY = { type: StateValueType.Enum as const, value: 'BUY' };
const SELL = { type: StateValueType.Enum as const, value: 'SELL' };

function openCondition(operator: NumericOperator, value: number): ConditionNode {
  return {
    kind: ConditionNodeKind.Leaf,
    left: { kind: OperandKind.OpenValue, valueType: StateValueType.Number },
    operator,
    right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value } },
  };
}

function signalNotEquals(value: { type: StateValueType.Enum; value: string }): ConditionNode {
  return {
    kind: ConditionNodeKind.Leaf,
    left: { kind: OperandKind.SymbolStateRef, key: 'signal', valueType: StateValueType.Enum },
    operator: StateOperator.NotEquals,
    right: { kind: OperandKind.Literal, value },
  };
}

const testBuy: Rule = {
  id: 'test-buy',
  profileId: PROFILE_ID,
  name: 'test-buy',
  scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
  condition: {
    kind: ConditionNodeKind.And,
    children: [openCondition(NumericOperator.Gte, THRESHOLD), signalNotEquals(BUY)],
  },
  trigger: { kind: TriggerKind.OncePerBar, period: Period.OneMinute },
  expiration: null,
  actions: [{ kind: ActionKind.SetSymbolState, key: 'signal', value: BUY }],
  enabled: true,
  events: [],
  history: [],
  createdAt: 0,
  updatedAt: 0,
  order: 1,
};

const testSell: Rule = {
  id: 'test-sell',
  profileId: PROFILE_ID,
  name: 'test-sell',
  scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
  condition: {
    kind: ConditionNodeKind.And,
    children: [openCondition(NumericOperator.Lt, THRESHOLD), signalNotEquals(SELL)],
  },
  trigger: { kind: TriggerKind.OncePerBar, period: Period.OneMinute },
  expiration: null,
  actions: [{ kind: ActionKind.SetSymbolState, key: 'signal', value: SELL }],
  enabled: true,
  events: [],
  history: [],
  createdAt: 0,
  updatedAt: 0,
  order: 2,
};

function buildDriver() {
  const rules = new InMemoryRuleRepository([testBuy, testSell]);
  const watchlist = new InMemoryWatchlistRepository();
  const state = new InMemoryStateRepository();
  const notifier = new InMemoryNotifier(['main']);
  const eventLog = new InMemoryEventLog(() => 999);
  const firingState = new InMemoryFiringStateRepository();
  const wired = wireRuleEngine({ rules, watchlist, state, notifier, eventLog, firingState });
  return { rules, state, notifier, eventLog, wired };
}

function candle(time: number, open: number): EquityCandle {
  return {
    type: SymbolType.Stock,
    time,
    open,
    high: open,
    low: open,
    close: open,
    volume: 1_000,
  };
}

async function pushCandle(
  driver: ReturnType<typeof buildDriver>,
  time: number,
  open: number,
): Promise<void> {
  driver.wired.candleBridge.handleCandle({
    id: SYMBOL_ID,
    period: Period.OneMinute,
    candle: candle(time, open),
    final: false,
  });
  await driver.wired.drain();
}

describe('buy/sell flip-flop oscillation (e2e)', () => {
  it('five 1m bars with Open [0.02635, 0.02635, 0.02633, 0.02633, 0.02635] produce exactly two buy fires and one sell fire — bootstrap with no pre-seeded `signal`', async () => {
    const driver = buildDriver();

    await pushCandle(driver, 60_000, 0.02635); // bar 1 above → buy
    await pushCandle(driver, 120_000, 0.02635); // bar 2 above + already BUY → silent
    await pushCandle(driver, 180_000, 0.02633); // bar 3 below → sell
    await pushCandle(driver, 240_000, 0.02633); // bar 4 below + already SELL → silent
    await pushCandle(driver, 300_000, 0.02635); // bar 5 above → buy

    const buyFireTs = (await driver.eventLog.ruleEvents('test-buy'))
      .filter((event) => event.type === RuleEventType.Fired)
      .map((event) => event.ts);
    const sellFireTs = (await driver.eventLog.ruleEvents('test-sell'))
      .filter((event) => event.type === RuleEventType.Fired)
      .map((event) => event.ts);

    expect({
      buyFireTs,
      sellFireTs,
      stored: await driver.state.getSymbolState(PROFILE_ID, SYMBOL_ID, 'signal'),
    }).toEqual({
      buyFireTs: [60_000, 300_000],
      sellFireTs: [180_000],
      stored: BUY,
    });
  });
});
