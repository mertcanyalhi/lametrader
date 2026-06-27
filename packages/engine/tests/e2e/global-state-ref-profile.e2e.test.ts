import {
  ActionKind,
  ConditionNodeKind,
  NumericOperator,
  OperandKind,
  Period,
  type Rule,
  RuleEventType,
  RuleScopeKind,
  StateOperator,
  StateScope,
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
 * E2e for #325 — `GlobalStateRef` operand semantics:
 *
 * - global state writes are visible across symbols within the same profile
 *   via the `LiveEvaluationLookups` mirror;
 * - they are invisible to rules in another profile (#281 partitioning);
 * - `SetGlobalState` / `RemoveGlobalState` actions produce `StateSet` /
 *   `StateRemoved` rule-event entries on every fire;
 * - an `AllSymbols` reader fans out across the profile's watched symbols
 *   on the global-state cascade in the same `process()` tick.
 */

const AAPL = 'stock:AAPL';
const MSFT = 'stock:MSFT';
const PROFILE_A = 'profile-a';
const PROFILE_B = 'profile-b';

const RISK_ON = { type: StateValueType.Enum as const, value: 'RISK_ON' };
const RISK_OFF = { type: StateValueType.Enum as const, value: 'RISK_OFF' };

function buildDriver(seedRules: Rule[]) {
  const rules = new InMemoryRuleRepository(seedRules);
  const watchlist = new InMemoryWatchlistRepository([
    {
      id: AAPL,
      type: SymbolType.Stock,
      description: 'Apple',
      exchange: 'NMS',
      periods: [Period.OneMinute],
    },
    {
      id: MSFT,
      type: SymbolType.Stock,
      description: 'Microsoft',
      exchange: 'NMS',
      periods: [Period.OneMinute],
    },
  ]);
  const state = new InMemoryStateRepository();
  const notifier = new InMemoryNotifier(['main']);
  const eventLog = new InMemoryEventLog(() => 999);
  const firingState = new InMemoryFiringStateRepository();
  const wired = wireRuleEngine({ rules, watchlist, state, notifier, eventLog, firingState });
  return { rules, notifier, eventLog, wired };
}

async function pushQuote(
  driver: ReturnType<typeof buildDriver>,
  symbolId: string,
  price: number,
  time: number,
): Promise<void> {
  driver.wired.quoteBridge.handleQuote({
    subscriptionId: 's',
    id: symbolId,
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

describe('GlobalStateRef + profile partitioning (e2e)', () => {
  it('a same-profile `AllSymbols` reader observes the global state set by a `Symbol(AAPL)` writer', async () => {
    const driver = buildDriver([
      {
        id: 'a-writer',
        profileId: PROFILE_A,
        name: 'a-writer',
        scope: { kind: RuleScopeKind.Symbol, symbolId: AAPL },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
          operator: NumericOperator.Eq,
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 10 } },
        },
        trigger: { kind: TriggerKind.Once },
        expiration: null,
        actions: [{ kind: ActionKind.SetGlobalState, key: 'mode', value: RISK_ON }],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 1,
      },
      {
        id: 'a-reader',
        profileId: PROFILE_A,
        name: 'a-reader',
        scope: { kind: RuleScopeKind.AllSymbols },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.GlobalStateRef, key: 'mode', valueType: StateValueType.Enum },
          operator: StateOperator.Equals,
          right: { kind: OperandKind.Literal, value: RISK_ON },
        },
        trigger: { kind: TriggerKind.OncePerBar, period: Period.OneMinute },
        expiration: null,
        actions: [
          { kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'a-reader' },
        ],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 2,
      },
    ]);

    await pushQuote(driver, AAPL, 10, 0);

    // AllSymbols reader fires once per watched symbol (AAPL on the quote
    // event, MSFT on the cascade fanout) in the same `process()` tick.
    expect({
      writer: await fireCount(driver, 'a-writer'),
      reader: await fireCount(driver, 'a-reader'),
    }).toEqual({ writer: 1, reader: 2 });
  });

  it('a cross-profile reader does not observe profile A`s global state write — #281 partitioning', async () => {
    const driver = buildDriver([
      {
        id: 'a-writer',
        profileId: PROFILE_A,
        name: 'a-writer',
        scope: { kind: RuleScopeKind.Symbol, symbolId: AAPL },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
          operator: NumericOperator.Eq,
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 10 } },
        },
        trigger: { kind: TriggerKind.Once },
        expiration: null,
        actions: [{ kind: ActionKind.SetGlobalState, key: 'mode', value: RISK_ON }],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 1,
      },
      {
        id: 'b-reader',
        profileId: PROFILE_B,
        name: 'b-reader',
        scope: { kind: RuleScopeKind.AllSymbols },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.GlobalStateRef, key: 'mode', valueType: StateValueType.Enum },
          operator: StateOperator.Equals,
          right: { kind: OperandKind.Literal, value: RISK_ON },
        },
        trigger: { kind: TriggerKind.OncePerBar, period: Period.OneMinute },
        expiration: null,
        actions: [
          { kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'b-reader' },
        ],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 2,
      },
    ]);

    await pushQuote(driver, AAPL, 10, 0);

    expect({
      notified: driver.notifier.sent,
      writer: await fireCount(driver, 'a-writer'),
      reader: await fireCount(driver, 'b-reader'),
    }).toEqual({ notified: [], writer: 1, reader: 0 });
  });

  it('a follow-up `SetGlobalState` with a different value re-arms the reader; `RemoveGlobalState` logs a `StateRemoved` entry', async () => {
    const driver = buildDriver([
      {
        id: 'set-on',
        profileId: PROFILE_A,
        name: 'set-on',
        scope: { kind: RuleScopeKind.Symbol, symbolId: AAPL },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
          operator: NumericOperator.Eq,
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 10 } },
        },
        trigger: { kind: TriggerKind.Once },
        expiration: null,
        actions: [{ kind: ActionKind.SetGlobalState, key: 'mode', value: RISK_ON }],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 1,
      },
      {
        id: 'set-off',
        profileId: PROFILE_A,
        name: 'set-off',
        scope: { kind: RuleScopeKind.Symbol, symbolId: AAPL },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
          operator: NumericOperator.Eq,
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 20 } },
        },
        trigger: { kind: TriggerKind.Once },
        expiration: null,
        actions: [{ kind: ActionKind.SetGlobalState, key: 'mode', value: RISK_OFF }],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 2,
      },
      {
        id: 'remove',
        profileId: PROFILE_A,
        name: 'remove',
        scope: { kind: RuleScopeKind.Symbol, symbolId: AAPL },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
          operator: NumericOperator.Eq,
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 30 } },
        },
        trigger: { kind: TriggerKind.Once },
        expiration: null,
        actions: [{ kind: ActionKind.RemoveGlobalState, key: 'mode' }],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 3,
      },
    ]);

    await pushQuote(driver, AAPL, 10, 0);
    await pushQuote(driver, AAPL, 20, 60_000);
    await pushQuote(driver, AAPL, 30, 120_000);

    const setOnEvents = await driver.eventLog.ruleEvents('set-on');
    const setOffEvents = await driver.eventLog.ruleEvents('set-off');
    const removeEvents = await driver.eventLog.ruleEvents('remove');
    expect({
      setOnStateSet: setOnEvents
        .filter((event) => event.type === RuleEventType.StateSet)
        .map((event) => ({
          scope: 'scope' in event ? event.scope : null,
          key: 'key' in event ? event.key : null,
        })),
      setOffStateSet: setOffEvents
        .filter((event) => event.type === RuleEventType.StateSet)
        .map((event) => ({
          scope: 'scope' in event ? event.scope : null,
          key: 'key' in event ? event.key : null,
        })),
      removeStateRemoved: removeEvents
        .filter((event) => event.type === RuleEventType.StateRemoved)
        .map((event) => ({
          scope: 'scope' in event ? event.scope : null,
          key: 'key' in event ? event.key : null,
        })),
    }).toEqual({
      setOnStateSet: [{ scope: StateScope.Global, key: 'mode' }],
      setOffStateSet: [{ scope: StateScope.Global, key: 'mode' }],
      removeStateRemoved: [{ scope: StateScope.Global, key: 'mode' }],
    });
  });

  it('an `AllSymbols` reader fans out across watched symbols on the global-state cascade in the same `process()` tick', async () => {
    const driver = buildDriver([
      {
        id: 'a-writer',
        profileId: PROFILE_A,
        name: 'a-writer',
        scope: { kind: RuleScopeKind.Symbol, symbolId: AAPL },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
          operator: NumericOperator.Eq,
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 10 } },
        },
        trigger: { kind: TriggerKind.Once },
        expiration: null,
        actions: [{ kind: ActionKind.SetGlobalState, key: 'mode', value: RISK_ON }],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 1,
      },
      {
        id: 'fan-reader',
        profileId: PROFILE_A,
        name: 'fan-reader',
        scope: { kind: RuleScopeKind.AllSymbols },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.GlobalStateRef, key: 'mode', valueType: StateValueType.Enum },
          operator: StateOperator.Equals,
          right: { kind: OperandKind.Literal, value: RISK_ON },
        },
        trigger: { kind: TriggerKind.OncePerBar, period: Period.OneMinute },
        expiration: null,
        actions: [
          { kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'fan-reader' },
        ],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 2,
      },
    ]);

    await pushQuote(driver, AAPL, 10, 0);

    const aaplFires = (await driver.eventLog.symbolEvents(AAPL)).filter(
      (event) => event.type === RuleEventType.Fired && event.ruleId === 'fan-reader',
    );
    const msftFires = (await driver.eventLog.symbolEvents(MSFT)).filter(
      (event) => event.type === RuleEventType.Fired && event.ruleId === 'fan-reader',
    );
    expect({
      aaplFires: aaplFires.length,
      msftFires: msftFires.length,
    }).toEqual({ aaplFires: 1, msftFires: 1 });
  });
});
