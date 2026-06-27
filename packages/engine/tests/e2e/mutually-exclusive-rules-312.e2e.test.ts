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
 * E2e regression for #312 — two `OncePerBar(1m)` rules sharing a state
 * key (`signal`) with mutually-exclusive `Open >= 0.02634` /
 * `Open < 0.02634` conditions must NOT both fire on the same 1m candle.
 *
 * The fix in #334 makes the orchestrator read OHLCV operands from the
 * inbound event itself (rather than the live cache, which can be stale
 * when the bar's open was just recorded). This suite drives candles
 * whose Open straddles the threshold and asserts the exclusivity holds.
 */

const SYMBOL_ID = 'crypto:BTCUSDT';
const PROFILE_ID = 'profile-1';
const THRESHOLD = 0.02634;

const BUY = { type: StateValueType.Enum as const, value: 'BUY' };
const SELL = { type: StateValueType.Enum as const, value: 'SELL' };
const NONE = { type: StateValueType.Enum as const, value: 'NONE' };

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

function buildDriver(seedRules: Rule[]) {
  const rules = new InMemoryRuleRepository(seedRules);
  const watchlist = new InMemoryWatchlistRepository();
  const state = new InMemoryStateRepository();
  const notifier = new InMemoryNotifier(['main']);
  const eventLog = new InMemoryEventLog(() => 999);
  const firingState = new InMemoryFiringStateRepository();
  const wired = wireRuleEngine({ rules, watchlist, state, notifier, eventLog, firingState });
  return { rules, state, notifier, eventLog, wired };
}

function candle(time: number, open: number): EquityCandle {
  // High / low / close / volume don't matter for these rules; only `open`
  // is in any condition.
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

async function fireCount(driver: ReturnType<typeof buildDriver>, ruleId: string): Promise<number> {
  const events = await driver.eventLog.ruleEvents(ruleId);
  return events.filter((event) => event.type === RuleEventType.Fired).length;
}

describe('mutually-exclusive rules sharing `signal` state (#312 regression) (e2e)', () => {
  it('bar with `Open = 0.02633` (below threshold) fires only test-sell', async () => {
    const driver = buildDriver([testBuy, testSell]);
    // Seed `signal` to NONE so `NotEquals BUY` / `NotEquals SELL` both
    // resolve to true (state operators return false against a `null`
    // left, per the engine contract — see #320 coverage).
    await driver.state.setSymbolState(PROFILE_ID, SYMBOL_ID, 'signal', NONE, 0);

    await pushCandle(driver, 60_000, 0.02633);

    expect({
      buyFires: await fireCount(driver, 'test-buy'),
      sellFires: await fireCount(driver, 'test-sell'),
      stored: await driver.state.getSymbolState(PROFILE_ID, SYMBOL_ID, 'signal'),
    }).toEqual({ buyFires: 0, sellFires: 1, stored: SELL });
  });

  it('bar with `Open = 0.02635` (above threshold) fires only test-buy', async () => {
    const driver = buildDriver([testBuy, testSell]);
    await driver.state.setSymbolState(PROFILE_ID, SYMBOL_ID, 'signal', NONE, 0);

    await pushCandle(driver, 60_000, 0.02635);

    expect({
      buyFires: await fireCount(driver, 'test-buy'),
      sellFires: await fireCount(driver, 'test-sell'),
      stored: await driver.state.getSymbolState(PROFILE_ID, SYMBOL_ID, 'signal'),
    }).toEqual({ buyFires: 1, sellFires: 0, stored: BUY });
  });

  it('bar with `Open = 0.02634` (exact threshold) fires only test-buy (`>=` true, `<` false)', async () => {
    const driver = buildDriver([testBuy, testSell]);
    await driver.state.setSymbolState(PROFILE_ID, SYMBOL_ID, 'signal', NONE, 0);

    await pushCandle(driver, 60_000, 0.02634);

    expect({
      buyFires: await fireCount(driver, 'test-buy'),
      sellFires: await fireCount(driver, 'test-sell'),
      stored: await driver.state.getSymbolState(PROFILE_ID, SYMBOL_ID, 'signal'),
    }).toEqual({ buyFires: 1, sellFires: 0, stored: BUY });
  });

  it('cascade isolation — test-buy fires and writes `signal = BUY`; the cascade does not re-trigger test-sell on the same bar', async () => {
    const driver = buildDriver([testBuy, testSell]);
    await driver.state.setSymbolState(PROFILE_ID, SYMBOL_ID, 'signal', NONE, 0);

    await pushCandle(driver, 60_000, 0.02635);

    // After test-buy fires and writes `signal = BUY`, the cascade
    // `SymbolStateChanged(prev=NONE, current=BUY)` re-enters the
    // orchestrator. test-sell's `Open < threshold` branch is still false
    // for this bar (because the inbound event's `current` is the bar's
    // open, per the #334 fix), so the And short-circuits and test-sell
    // stays silent.
    expect({
      buyFires: await fireCount(driver, 'test-buy'),
      sellFires: await fireCount(driver, 'test-sell'),
    }).toEqual({ buyFires: 1, sellFires: 0 });
  });

  it('two adjacent bars (below then above threshold) — exactly one `Fired` per bar, alternating sides', async () => {
    const driver = buildDriver([testBuy, testSell]);
    // Seed `signal` to NONE so `NotEquals BUY` / `NotEquals SELL` both
    // resolve to true (state operators return false against a `null`
    // left, per the engine contract — see #320 coverage).
    await driver.state.setSymbolState(PROFILE_ID, SYMBOL_ID, 'signal', NONE, 0);

    await pushCandle(driver, 60_000, 0.02633); // below → sell
    await pushCandle(driver, 120_000, 0.02635); // above → buy

    const buyFires = (await driver.eventLog.ruleEvents('test-buy')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    const sellFires = (await driver.eventLog.ruleEvents('test-sell')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    expect({
      buyFireTs: buyFires.map((event) => event.ts),
      sellFireTs: sellFires.map((event) => event.ts),
      stored: await driver.state.getSymbolState(PROFILE_ID, SYMBOL_ID, 'signal'),
    }).toEqual({
      buyFireTs: [120_000],
      sellFireTs: [60_000],
      stored: BUY,
    });
  });
});
