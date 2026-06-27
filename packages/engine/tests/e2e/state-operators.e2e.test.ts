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
 * E2e for #320 — covers every `StateOperator` end-to-end via the real
 * state-change cascade.
 *
 * Writer rules update `state.signal` across `IDLE → BUY → SELL → IDLE`
 * (one writer per transition, all triggered by distinct quote prices).
 * One reader rule per test is configured with a different `StateOperator`
 * and asserts it fires only on the transitions its semantics demand.
 *
 * The reader uses `OncePerBar(1m)` so it can fire in multiple bars (each
 * writer's triggering quote lands in a distinct 1m bar) without the
 * `Once`-trigger auto-disable curtailing the assertion.
 */

const SYMBOL_ID = 'stock:AAPL';
const PROFILE_ID = 'profile-1';

const IDLE = { type: StateValueType.Enum as const, value: 'IDLE' };
const BUY = { type: StateValueType.Enum as const, value: 'BUY' };
const SELL = { type: StateValueType.Enum as const, value: 'SELL' };

/**
 * Build a writer rule that fires once when `current == triggerPrice` and
 * writes `value` into `state.signal`.
 */
function writer(
  id: string,
  triggerPrice: number,
  value: { type: StateValueType.Enum; value: string },
  order: number,
): Rule {
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
    actions: [{ kind: ActionKind.SetSymbolState, key: 'signal', value }],
    enabled: true,
    events: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
    order,
  };
}

/**
 * Build a reader rule with the given state operator, listening on
 * `state.signal` against the literal `right`.
 */
function reader(
  id: string,
  operator: StateOperator,
  right: { type: StateValueType.Enum; value: string },
): Rule {
  return {
    id,
    profileId: PROFILE_ID,
    name: id,
    scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
    condition: {
      kind: ConditionNodeKind.Leaf,
      left: { kind: OperandKind.SymbolStateRef, key: 'signal', valueType: StateValueType.Enum },
      operator,
      right: { kind: OperandKind.Literal, value: right },
    },
    trigger: { kind: TriggerKind.OncePerBar, period: Period.OneMinute },
    expiration: null,
    actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: id }],
    enabled: true,
    events: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
    order: 10,
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

async function fireCount(driver: ReturnType<typeof buildDriver>, ruleId: string): Promise<number> {
  const events = await driver.eventLog.ruleEvents(ruleId);
  return events.filter((event) => event.type === RuleEventType.Fired).length;
}

/**
 * Drive the `IDLE → BUY → SELL → IDLE` writer cycle through `driver`.
 * Each transition lands in a distinct 1m bar so an `OncePerBar(1m)` reader
 * is not gated by intra-bar suppression.
 */
async function runWriterCycle(driver: ReturnType<typeof buildDriver>): Promise<void> {
  // Pre-seed `signal` to IDLE OUTSIDE any `process()` call so the
  // `LiveEvaluationLookups` cache is warm but no cascade event flows
  // through the orchestrator (its `onStateChanged` subscription is only
  // active during a `process()` call).
  await driver.state.setSymbolState(PROFILE_ID, SYMBOL_ID, 'signal', IDLE, 0);

  // Each quote lands in a distinct 1m bar so OncePerBar gates correctly.
  await pushQuote(driver, 10, 0); // Writer→BUY, cascade IDLE→BUY at ts=0.
  await pushQuote(driver, 20, 60_000); // Writer→SELL, cascade BUY→SELL at ts=60_000.
  await pushQuote(driver, 30, 120_000); // Writer→IDLE, cascade SELL→IDLE at ts=120_000.
}

describe('state operators (e2e)', () => {
  it('`Equals BUY` fires once when `signal` reaches BUY; silent on SELL and IDLE', async () => {
    const driver = buildDriver([
      writer('w-buy', 10, BUY, 1),
      writer('w-sell', 20, SELL, 2),
      writer('w-idle', 30, IDLE, 3),
      reader('r-equals', StateOperator.Equals, BUY),
    ]);

    await runWriterCycle(driver);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'r-equals'),
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'r-equals' }],
      fires: 1,
    });
  });

  it('`NotEquals BUY` fires twice — once on BUY→SELL bar, once on SELL→IDLE bar', async () => {
    const driver = buildDriver([
      writer('w-buy', 10, BUY, 1),
      writer('w-sell', 20, SELL, 2),
      writer('w-idle', 30, IDLE, 3),
      reader('r-neq', StateOperator.NotEquals, BUY),
    ]);

    await runWriterCycle(driver);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'r-neq'),
    }).toEqual({
      notified: [
        { destinationName: 'main', body: 'r-neq' },
        { destinationName: 'main', body: 'r-neq' },
      ],
      fires: 2,
    });
  });

  it('`ChangesTo BUY` fires once on the IDLE→BUY cascade; silent on BUY→SELL and SELL→IDLE', async () => {
    const driver = buildDriver([
      writer('w-buy', 10, BUY, 1),
      writer('w-sell', 20, SELL, 2),
      writer('w-idle', 30, IDLE, 3),
      reader('r-to', StateOperator.ChangesTo, BUY),
    ]);

    await runWriterCycle(driver);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'r-to'),
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'r-to' }],
      fires: 1,
    });
  });

  it('`ChangesFrom BUY` fires once on the BUY→SELL cascade; silent on IDLE→BUY and SELL→IDLE', async () => {
    const driver = buildDriver([
      writer('w-buy', 10, BUY, 1),
      writer('w-sell', 20, SELL, 2),
      writer('w-idle', 30, IDLE, 3),
      reader('r-from', StateOperator.ChangesFrom, BUY),
    ]);

    await runWriterCycle(driver);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'r-from'),
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'r-from' }],
      fires: 1,
    });
  });

  it('a no-op `BUY→BUY` write emits no cascade event — a `ChangesTo BUY` reader stays silent', async () => {
    const driver = buildDriver([
      writer('w-buy-again', 10, BUY, 1),
      reader('r-to-noop', StateOperator.ChangesTo, BUY),
    ]);

    // Pre-seed `signal` already at BUY so the writer's set is a no-op
    // (`InMemoryStateRepository.setSymbolState` dedupes equal writes).
    await driver.state.setSymbolState(PROFILE_ID, SYMBOL_ID, 'signal', BUY, 0);
    await pushQuote(driver, 10, 0);

    expect({
      notified: driver.notifier.sent,
      fires: await fireCount(driver, 'r-to-noop'),
    }).toEqual({ notified: [], fires: 0 });
  });
});
