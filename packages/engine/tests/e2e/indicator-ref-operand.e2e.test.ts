import {
  ActionKind,
  ConditionNodeKind,
  type IndicatorStateEvent,
  NumericOperator,
  OperandKind,
  Period,
  type Rule,
  RuleEventType,
  RuleScopeKind,
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
 * E2e for #324 — `IndicatorRef` operand end-to-end through the
 * `IndicatorRuleEventBridge` into the orchestrator.
 *
 * Each test wires `sub-1 → sma-5` (and optionally `sub-2 → sma-10`),
 * pushes one or more `IndicatorStateEvent`s, and asserts the consuming
 * rule fires only when the bound `(instanceId, stateKey)` matches and
 * the numeric condition holds.
 */

const SYMBOL_ID = 'stock:AAPL';
const PROFILE_ID = 'profile-1';
const SUBSCRIPTION_ID = 'sub-1';
const INSTANCE_ID = 'sma-5';
const STATE_KEY = 'value';

function indicatorRule(id: string, instanceId: string, stateKey: string, threshold: number): Rule {
  return {
    id,
    profileId: PROFILE_ID,
    name: id,
    scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
    condition: {
      kind: ConditionNodeKind.Leaf,
      left: {
        kind: OperandKind.IndicatorRef,
        instanceId,
        stateKey,
        valueType: StateValueType.Number,
      },
      operator: NumericOperator.Gt,
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

function event(
  subscriptionId: string,
  time: number,
  state: Record<string, number | string | boolean>,
): IndicatorStateEvent {
  return {
    subscriptionId,
    id: SYMBOL_ID,
    period: Period.OneMinute,
    indicatorKey: 'sma',
    state: { time, ...state },
    final: false,
  };
}

async function pushIndicatorEvent(
  driver: ReturnType<typeof buildDriver>,
  ev: IndicatorStateEvent,
): Promise<void> {
  driver.wired.indicatorBridge.handleState(ev);
  await driver.wired.drain();
}

async function fireCount(driver: ReturnType<typeof buildDriver>, ruleId: string): Promise<number> {
  const events = await driver.eventLog.ruleEvents(ruleId);
  return events.filter((e) => e.type === RuleEventType.Fired).length;
}

describe('IndicatorRef operand (e2e)', () => {
  it('positive — fires when the bound indicator value crosses above the threshold', async () => {
    const driver = buildDriver(indicatorRule('positive', INSTANCE_ID, STATE_KEY, 100));
    driver.wired.indicatorBridge.bindSubscription(SUBSCRIPTION_ID, INSTANCE_ID);

    await pushIndicatorEvent(driver, event(SUBSCRIPTION_ID, 1_000, { [STATE_KEY]: 101 }));

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'positive'),
      enabled: (await driver.rules.get('positive'))?.enabled,
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'positive' }],
      fires: 1,
      enabled: false,
    });
  });

  it('negative — does not fire when the indicator value stays below the threshold across multiple events', async () => {
    const driver = buildDriver(indicatorRule('negative', INSTANCE_ID, STATE_KEY, 100));
    driver.wired.indicatorBridge.bindSubscription(SUBSCRIPTION_ID, INSTANCE_ID);

    await pushIndicatorEvent(driver, event(SUBSCRIPTION_ID, 1_000, { [STATE_KEY]: 90 }));
    await pushIndicatorEvent(driver, event(SUBSCRIPTION_ID, 2_000, { [STATE_KEY]: 95 }));
    await pushIndicatorEvent(driver, event(SUBSCRIPTION_ID, 3_000, { [STATE_KEY]: 99 }));

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'negative'),
    }).toEqual({ notified: [], fires: 0 });
  });

  it('missing indicator — a rule referencing an unbound `instanceId` does not fire even when a different `instanceId`s value-bearing event arrives', async () => {
    const driver = buildDriver(indicatorRule('missing', 'sma-5', STATE_KEY, 100));
    // Bind a DIFFERENT instance — sma-5 is never bound.
    driver.wired.indicatorBridge.bindSubscription('sub-other', 'sma-10');

    await pushIndicatorEvent(driver, event('sub-other', 1_000, { [STATE_KEY]: 500 }));

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'missing'),
    }).toEqual({ notified: [], fires: 0 });
  });

  it('wrong instance — an event for a different `instanceId` does not fire a rule referencing `sma-5`', async () => {
    const driver = buildDriver(indicatorRule('wrong-instance', 'sma-5', STATE_KEY, 100));
    // Two bindings: sub-1→sma-5 (rule's target) and sub-2→sma-10 (mismatch).
    driver.wired.indicatorBridge.bindSubscription(SUBSCRIPTION_ID, 'sma-5');
    driver.wired.indicatorBridge.bindSubscription('sub-2', 'sma-10');

    // Push an event on the *other* instance — qualifying value, but wrong
    // `instanceId` per the rule's `IndicatorRef`.
    await pushIndicatorEvent(driver, event('sub-2', 1_000, { [STATE_KEY]: 500 }));

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'wrong-instance'),
    }).toEqual({ notified: [], fires: 0 });
  });

  it('cross-key isolation — an event mutating `sma-5.signal` does not fire a rule referencing `sma-5.value`', async () => {
    const driver = buildDriver(indicatorRule('cross-key', INSTANCE_ID, 'value', 100));
    driver.wired.indicatorBridge.bindSubscription(SUBSCRIPTION_ID, INSTANCE_ID);

    // Push an event that updates a different stateKey on the same
    // instance — no `value` key in the state row.
    await pushIndicatorEvent(driver, event(SUBSCRIPTION_ID, 1_000, { signal: 200 }));

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'cross-key'),
    }).toEqual({ notified: [], fires: 0 });
  });
});
