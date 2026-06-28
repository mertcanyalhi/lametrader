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
 * E2e for #333 — three-rule A→B→C cascade chain through shared
 * symbol-state keys. A writes `state.a`, B reads `a` and writes
 * `state.b`, C reads `b` and notifies. One inbound quote drives the
 * full chain within the default `cycleLimit` (4 per ADR 0012).
 */

const SYMBOL_ID = 'stock:AAPL';
const PROFILE_ID = 'profile-1';

const ONE = { type: StateValueType.Number as const, value: 1 };

function ruleA(order: number): Rule {
  return {
    id: 'A',
    profileId: PROFILE_ID,
    name: 'A',
    scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
    condition: {
      kind: ConditionNodeKind.Leaf,
      left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
      operator: NumericOperator.Gt,
      right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
    },
    trigger: { kind: TriggerKind.Once },
    expiration: null,
    actions: [{ kind: ActionKind.SetSymbolState, key: 'a', value: ONE }],
    enabled: true,
    events: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
    order,
  };
}

function ruleB(order: number): Rule {
  return {
    id: 'B',
    profileId: PROFILE_ID,
    name: 'B',
    scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
    condition: {
      kind: ConditionNodeKind.Leaf,
      left: { kind: OperandKind.SymbolStateRef, key: 'a', valueType: StateValueType.Number },
      operator: StateOperator.Equals,
      right: { kind: OperandKind.Literal, value: ONE },
    },
    trigger: { kind: TriggerKind.Once },
    expiration: null,
    actions: [{ kind: ActionKind.SetSymbolState, key: 'b', value: ONE }],
    enabled: true,
    events: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
    order,
  };
}

function ruleC(order: number): Rule {
  return {
    id: 'C',
    profileId: PROFILE_ID,
    name: 'C',
    scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
    condition: {
      kind: ConditionNodeKind.Leaf,
      left: { kind: OperandKind.SymbolStateRef, key: 'b', valueType: StateValueType.Number },
      operator: StateOperator.Equals,
      right: { kind: OperandKind.Literal, value: ONE },
    },
    trigger: { kind: TriggerKind.Once },
    expiration: null,
    actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'C' }],
    enabled: true,
    events: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
    order,
  };
}

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

describe('three-rule A→B→C cascade chain (e2e)', () => {
  it('all three rules fire in order with `Fired` / `StateSet` / `NotificationSent` interleaved on the symbol log', async () => {
    const driver = buildDriver([ruleA(1), ruleB(2), ruleC(3)]);

    await pushQuote(driver, 100, 1_000);

    const symbolEvents = await driver.eventLog.symbolEvents(SYMBOL_ID);
    const sequence = symbolEvents
      .filter(
        (event) =>
          event.type === RuleEventType.StateSet ||
          event.type === RuleEventType.NotificationSent ||
          event.type === RuleEventType.Fired ||
          event.type === RuleEventType.CycleOverflow,
      )
      .map((event) => ({ type: event.type, ruleId: event.ruleId }));
    expect({
      notified: driver.notifier.sent,
      sequence,
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'C' }],
      sequence: [
        { type: RuleEventType.StateSet, ruleId: 'A' },
        { type: RuleEventType.Fired, ruleId: 'A' },
        { type: RuleEventType.StateSet, ruleId: 'B' },
        { type: RuleEventType.Fired, ruleId: 'B' },
        { type: RuleEventType.NotificationSent, ruleId: 'C' },
        { type: RuleEventType.Fired, ruleId: 'C' },
      ],
    });
  });

  it('reordered rules (`C=1, B=2, A=3`) still complete the chain via cascade re-queueing', async () => {
    // Same rules, only `order` reversed — the orchestrator processes them
    // in `order` ascending per event, but each cascade event re-iterates
    // every enabled rule so the chain still completes (A fires on the
    // quote event, then B on A's cascade, then C on B's cascade).
    const driver = buildDriver([ruleA(3), ruleB(2), ruleC(1)]);

    await pushQuote(driver, 100, 1_000);

    const overflow = (await driver.eventLog.symbolEvents(SYMBOL_ID)).filter(
      (event) => event.type === RuleEventType.CycleOverflow,
    );
    expect({
      notified: driver.notifier.sent,
      overflowCount: overflow.length,
      aFires: (await driver.eventLog.ruleEvents('A')).filter(
        (event) => event.type === RuleEventType.Fired,
      ).length,
      bFires: (await driver.eventLog.ruleEvents('B')).filter(
        (event) => event.type === RuleEventType.Fired,
      ).length,
      cFires: (await driver.eventLog.ruleEvents('C')).filter(
        (event) => event.type === RuleEventType.Fired,
      ).length,
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'C' }],
      overflowCount: 0,
      aFires: 1,
      bFires: 1,
      cFires: 1,
    });
  });
});
