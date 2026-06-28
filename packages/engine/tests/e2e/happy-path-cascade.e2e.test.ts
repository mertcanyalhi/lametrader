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
 * E2e for #329 — happy-path cascade. Rule A's `SetSymbolState` or
 * `SetGlobalState` action emits a `SymbolStateChanged` / `GlobalStateChanged`
 * cascade event into the same `process()` tick; rule B's condition on that
 * key resolves through `LiveEvaluationLookups` and fires within the same
 * cycle budget.
 */

const SYMBOL_ID = 'stock:AAPL';
const PROFILE_ID = 'profile-1';

const ARMED_TRUE = { type: StateValueType.Bool as const, value: true };
const RISK_ON = { type: StateValueType.Enum as const, value: 'RISK_ON' };

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

describe('happy-path cascade (e2e)', () => {
  it('symbol-scoped cascade — A sets `state.armed = true`, B fires on `armed == true` in the same tick', async () => {
    const driver = buildDriver([
      {
        id: 'A-sym',
        profileId: PROFILE_ID,
        name: 'A-sym',
        scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
          operator: NumericOperator.Eq,
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 10 } },
        },
        trigger: { kind: TriggerKind.Once },
        expiration: null,
        actions: [{ kind: ActionKind.SetSymbolState, key: 'armed', value: ARMED_TRUE }],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 1,
      },
      {
        id: 'B-sym',
        profileId: PROFILE_ID,
        name: 'B-sym',
        scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.SymbolStateRef, key: 'armed', valueType: StateValueType.Bool },
          operator: StateOperator.Equals,
          right: { kind: OperandKind.Literal, value: ARMED_TRUE },
        },
        trigger: { kind: TriggerKind.Once },
        expiration: null,
        actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'B-sym' }],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 2,
      },
    ]);

    await pushQuote(driver, 10, 1_000);

    const aFires = (await driver.eventLog.ruleEvents('A-sym')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    const bFires = (await driver.eventLog.ruleEvents('B-sym')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    expect({
      notified: driver.notifier.sent,
      aFires: aFires.length,
      bFires: bFires.length,
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'B-sym' }],
      aFires: 1,
      bFires: 1,
    });
  });

  it('global-scoped cascade — A sets `global.mode = RISK_ON`, B fires on `gs(mode) == RISK_ON`', async () => {
    const driver = buildDriver([
      {
        id: 'A-glob',
        profileId: PROFILE_ID,
        name: 'A-glob',
        scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
          operator: NumericOperator.Eq,
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 20 } },
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
        id: 'B-glob',
        profileId: PROFILE_ID,
        name: 'B-glob',
        scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.GlobalStateRef, key: 'mode', valueType: StateValueType.Enum },
          operator: StateOperator.Equals,
          right: { kind: OperandKind.Literal, value: RISK_ON },
        },
        trigger: { kind: TriggerKind.Once },
        expiration: null,
        actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'B-glob' }],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 2,
      },
    ]);

    await pushQuote(driver, 20, 1_000);

    const aFires = (await driver.eventLog.ruleEvents('A-glob')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    const bFires = (await driver.eventLog.ruleEvents('B-glob')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    expect({
      notified: driver.notifier.sent,
      aFires: aFires.length,
      bFires: bFires.length,
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'B-glob' }],
      aFires: 1,
      bFires: 1,
    });
  });

  it('cascade ordering — symbol event log records `StateSet → Fired(A) → NotificationSent → Fired(B)` in that order', async () => {
    const driver = buildDriver([
      {
        id: 'A-order',
        profileId: PROFILE_ID,
        name: 'A-order',
        scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
          operator: NumericOperator.Eq,
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 30 } },
        },
        trigger: { kind: TriggerKind.Once },
        expiration: null,
        actions: [{ kind: ActionKind.SetSymbolState, key: 'armed', value: ARMED_TRUE }],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 1,
      },
      {
        id: 'B-order',
        profileId: PROFILE_ID,
        name: 'B-order',
        scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.SymbolStateRef, key: 'armed', valueType: StateValueType.Bool },
          operator: StateOperator.Equals,
          right: { kind: OperandKind.Literal, value: ARMED_TRUE },
        },
        trigger: { kind: TriggerKind.Once },
        expiration: null,
        actions: [
          { kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'B-order' },
        ],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 2,
      },
    ]);

    await pushQuote(driver, 30, 1_000);

    const symbolEvents = await driver.eventLog.symbolEvents(SYMBOL_ID);
    // Pull only the cascade-relevant entries — the symbol log also contains
    // a Fired entry for every successful action, separately from the umbrella.
    const sequence = symbolEvents
      .filter(
        (event) =>
          event.type === RuleEventType.StateSet ||
          event.type === RuleEventType.NotificationSent ||
          event.type === RuleEventType.Fired ||
          event.type === RuleEventType.CycleOverflow,
      )
      .map((event) => ({ type: event.type, ruleId: event.ruleId }));
    expect(sequence).toEqual([
      { type: RuleEventType.StateSet, ruleId: 'A-order' },
      { type: RuleEventType.Fired, ruleId: 'A-order' },
      { type: RuleEventType.NotificationSent, ruleId: 'B-order' },
      { type: RuleEventType.Fired, ruleId: 'B-order' },
    ]);
  });

  it('cycle counter stays under budget — no `CycleOverflow` event is emitted for a legitimate single-cascade chain', async () => {
    const driver = buildDriver([
      {
        id: 'A-budget',
        profileId: PROFILE_ID,
        name: 'A-budget',
        scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
          operator: NumericOperator.Eq,
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 40 } },
        },
        trigger: { kind: TriggerKind.Once },
        expiration: null,
        actions: [{ kind: ActionKind.SetSymbolState, key: 'armed', value: ARMED_TRUE }],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 1,
      },
      {
        id: 'B-budget',
        profileId: PROFILE_ID,
        name: 'B-budget',
        scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.SymbolStateRef, key: 'armed', valueType: StateValueType.Bool },
          operator: StateOperator.Equals,
          right: { kind: OperandKind.Literal, value: ARMED_TRUE },
        },
        trigger: { kind: TriggerKind.Once },
        expiration: null,
        actions: [
          { kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'B-budget' },
        ],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 2,
      },
    ]);

    await pushQuote(driver, 40, 1_000);

    const overflow = (await driver.eventLog.symbolEvents(SYMBOL_ID)).filter(
      (event) => event.type === RuleEventType.CycleOverflow,
    );
    expect(overflow.length).toBe(0);
  });

  it('no spurious re-fire — after A auto-disables on the first cascade, a second qualifying quote does not refire B', async () => {
    const driver = buildDriver([
      {
        id: 'A-once',
        profileId: PROFILE_ID,
        name: 'A-once',
        scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
          operator: NumericOperator.Eq,
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 50 } },
        },
        trigger: { kind: TriggerKind.Once },
        expiration: null,
        actions: [{ kind: ActionKind.SetSymbolState, key: 'armed', value: ARMED_TRUE }],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 1,
      },
      {
        id: 'B-once',
        profileId: PROFILE_ID,
        name: 'B-once',
        scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.SymbolStateRef, key: 'armed', valueType: StateValueType.Bool },
          operator: StateOperator.Equals,
          right: { kind: OperandKind.Literal, value: ARMED_TRUE },
        },
        trigger: { kind: TriggerKind.Once },
        expiration: null,
        actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'B-once' }],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 2,
      },
    ]);

    await pushQuote(driver, 50, 1_000);
    // Second qualifying quote — A is now disabled, B already fired.
    await pushQuote(driver, 50, 2_000);

    const aFires = (await driver.eventLog.ruleEvents('A-once')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    const bFires = (await driver.eventLog.ruleEvents('B-once')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    expect({
      notified: driver.notifier.sent,
      aFires: aFires.length,
      bFires: bFires.length,
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'B-once' }],
      aFires: 1,
      bFires: 1,
    });
  });
});
