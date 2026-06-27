import {
  ActionKind,
  ConditionNodeKind,
  NumericOperator,
  OperandKind,
  Period,
  type Rule,
  RuleEventType,
  RuleScopeKind,
  StateScope,
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
 * E2e for #326 — covers every state-mutating action variant
 * (`SetSymbolState` / `RemoveSymbolState` / `SetGlobalState` /
 * `RemoveGlobalState`) end-to-end. Each test fires one rule from a quote
 * event and asserts:
 *
 *  - the resulting `StateSet` / `StateRemoved` rule-event entry's scope,
 *    key, and (for Set) value;
 *  - the downstream `StateRepository.get*State` lookup returns the right
 *    value after the action runs.
 */

const SYMBOL_ID = 'stock:AAPL';
const PROFILE_ID = 'profile-1';

const ARMED_TRUE = { type: StateValueType.Bool as const, value: true };
const MODE_X = { type: StateValueType.Enum as const, value: 'X' };

function makeRule(id: string, triggerPrice: number, action: Rule['actions'][number]): Rule {
  return {
    id,
    profileId: PROFILE_ID,
    name: id,
    scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
    condition: {
      kind: ConditionNodeKind.Leaf,
      left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
      operator: NumericOperator.Eq,
      right: {
        kind: OperandKind.Literal,
        value: { type: StateValueType.Number, value: triggerPrice },
      },
    },
    trigger: { kind: TriggerKind.Once },
    expiration: null,
    actions: [action],
    enabled: true,
    events: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
    order: 1,
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

describe('state-mutating actions (e2e)', () => {
  it('`SetSymbolState` writes the value, emits `StateSet`, and is visible via `getSymbolState`', async () => {
    const driver = buildDriver([
      makeRule('arm', 10, { kind: ActionKind.SetSymbolState, key: 'armed', value: ARMED_TRUE }),
    ]);

    await pushQuote(driver, 10, 1_000);

    const ruleStateSet = (await driver.eventLog.ruleEvents('arm')).filter(
      (event) => event.type === RuleEventType.StateSet,
    );
    const symbolStateSet = (await driver.eventLog.symbolEvents(SYMBOL_ID)).filter(
      (event) => event.type === RuleEventType.StateSet,
    );
    expect({
      ruleStateSet: ruleStateSet.map((event) => ({
        scope: 'scope' in event ? event.scope : null,
        key: 'key' in event ? event.key : null,
        value: 'value' in event ? event.value : null,
      })),
      symbolStateSet: symbolStateSet.map((event) => ({
        scope: 'scope' in event ? event.scope : null,
        key: 'key' in event ? event.key : null,
        value: 'value' in event ? event.value : null,
      })),
      stored: await driver.state.getSymbolState(PROFILE_ID, SYMBOL_ID, 'armed'),
    }).toEqual({
      ruleStateSet: [{ scope: StateScope.Symbol, key: 'armed', value: ARMED_TRUE }],
      symbolStateSet: [{ scope: StateScope.Symbol, key: 'armed', value: ARMED_TRUE }],
      stored: ARMED_TRUE,
    });
  });

  it('`RemoveSymbolState` removes pre-seeded state, emits `StateRemoved`, and `getSymbolState` returns `null`', async () => {
    const driver = buildDriver([
      makeRule('disarm', 20, { kind: ActionKind.RemoveSymbolState, key: 'armed' }),
    ]);
    await driver.state.setSymbolState(PROFILE_ID, SYMBOL_ID, 'armed', ARMED_TRUE, 0);

    await pushQuote(driver, 20, 1_000);

    const ruleStateRemoved = (await driver.eventLog.ruleEvents('disarm')).filter(
      (event) => event.type === RuleEventType.StateRemoved,
    );
    expect({
      ruleStateRemoved: ruleStateRemoved.map((event) => ({
        scope: 'scope' in event ? event.scope : null,
        key: 'key' in event ? event.key : null,
      })),
      stored: await driver.state.getSymbolState(PROFILE_ID, SYMBOL_ID, 'armed'),
    }).toEqual({
      ruleStateRemoved: [{ scope: StateScope.Symbol, key: 'armed' }],
      stored: null,
    });
  });

  it('`SetGlobalState` writes the value, emits `StateSet` with `scope: Global`, and is visible via `getGlobalState`', async () => {
    const driver = buildDriver([
      makeRule('set-mode', 30, { kind: ActionKind.SetGlobalState, key: 'mode', value: MODE_X }),
    ]);

    await pushQuote(driver, 30, 1_000);

    const ruleStateSet = (await driver.eventLog.ruleEvents('set-mode')).filter(
      (event) => event.type === RuleEventType.StateSet,
    );
    expect({
      ruleStateSet: ruleStateSet.map((event) => ({
        scope: 'scope' in event ? event.scope : null,
        key: 'key' in event ? event.key : null,
        value: 'value' in event ? event.value : null,
      })),
      stored: await driver.state.getGlobalState(PROFILE_ID, 'mode'),
    }).toEqual({
      ruleStateSet: [{ scope: StateScope.Global, key: 'mode', value: MODE_X }],
      stored: MODE_X,
    });
  });

  it('`RemoveGlobalState` removes pre-seeded state, emits `StateRemoved` with `scope: Global`, and `getGlobalState` returns `null`', async () => {
    const driver = buildDriver([
      makeRule('clear-mode', 40, { kind: ActionKind.RemoveGlobalState, key: 'mode' }),
    ]);
    await driver.state.setGlobalState(PROFILE_ID, 'mode', MODE_X, 0);

    await pushQuote(driver, 40, 1_000);

    const ruleStateRemoved = (await driver.eventLog.ruleEvents('clear-mode')).filter(
      (event) => event.type === RuleEventType.StateRemoved,
    );
    expect({
      ruleStateRemoved: ruleStateRemoved.map((event) => ({
        scope: 'scope' in event ? event.scope : null,
        key: 'key' in event ? event.key : null,
      })),
      stored: await driver.state.getGlobalState(PROFILE_ID, 'mode'),
    }).toEqual({
      ruleStateRemoved: [{ scope: StateScope.Global, key: 'mode' }],
      stored: null,
    });
  });

  it('combined `[SetSymbolState, NotifyTelegram, SetGlobalState]` produces three event log entries plus a notifier send', async () => {
    const driver = buildDriver([
      {
        id: 'combo',
        profileId: PROFILE_ID,
        name: 'combo',
        scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
          operator: NumericOperator.Eq,
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 50 } },
        },
        trigger: { kind: TriggerKind.Once },
        expiration: null,
        actions: [
          { kind: ActionKind.SetSymbolState, key: 'armed', value: ARMED_TRUE },
          { kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'combo' },
          { kind: ActionKind.SetGlobalState, key: 'mode', value: MODE_X },
        ],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 1,
      },
    ]);

    await pushQuote(driver, 50, 1_000);

    const ruleEvents = await driver.eventLog.ruleEvents('combo');
    const eventTypes = ruleEvents
      .filter(
        (event) =>
          event.type === RuleEventType.StateSet ||
          event.type === RuleEventType.NotificationSent ||
          event.type === RuleEventType.Fired,
      )
      .map((event) => event.type);
    expect({
      notified: driver.notifier.sent,
      eventTypes,
      storedSymbol: await driver.state.getSymbolState(PROFILE_ID, SYMBOL_ID, 'armed'),
      storedGlobal: await driver.state.getGlobalState(PROFILE_ID, 'mode'),
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'combo' }],
      // Action order: SetSymbolState → NotifyTelegram → SetGlobalState; the
      // umbrella `Fired` event is appended after every action's entry.
      eventTypes: [
        RuleEventType.StateSet,
        RuleEventType.NotificationSent,
        RuleEventType.StateSet,
        RuleEventType.Fired,
      ],
      storedSymbol: ARMED_TRUE,
      storedGlobal: MODE_X,
    });
  });
});
