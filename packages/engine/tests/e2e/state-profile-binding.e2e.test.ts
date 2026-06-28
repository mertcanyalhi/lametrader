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
  type StateValue,
  StateValueType,
  type SymbolQuoteEvent,
  TriggerKind,
} from '@lametrader/core';
import {
  ActionRunner,
  type EvaluationLookups,
  InMemoryEventLog,
  InMemoryFiringStateRepository,
  InMemoryNotifier,
  InMemoryRuleRepository,
  InMemoryStateRepository,
  InMemoryWatchlistRepository,
  QuoteRuleEventBridge,
  RuleOrchestrator,
  TriggerEvaluator,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';

/**
 * E2e for #281 — state collection is partitioned by `profileId`.
 *
 * Drives `SymbolQuoteEvent`s through a real {@link QuoteRuleEventBridge}
 * into a {@link RuleOrchestrator} wired with the in-memory adapter family,
 * with two profiles (`profile-a`, `profile-b`) each owning one rule on the
 * same watched symbol. Asserts:
 *
 *   1. each profile's state write goes into its own namespace (happy path);
 *   2. a state write under profile A does NOT wake profile B's rule even when
 *      both condition on the same `(symbolId, state.key)` (the critical
 *      failure mode the partitioning is here to prevent).
 */

/**
 * Build a `SymbolQuoteEvent` for AAPL on the 1m period that beats the rules'
 * `current > 0` price-cross condition.
 */
function quote(price: number, time = 1000): SymbolQuoteEvent {
  return {
    subscriptionId: 'sub-1',
    id: 'AAPL',
    period: Period.OneMinute,
    quote: { price, change: 0, changePct: 0, time },
    final: false,
  };
}

/**
 * Build a rule that fires on `current > 0` and writes `state.trend = up`
 * under the given profile.
 */
function setTrendRule(profileId: string, id: string, order: number): Rule {
  return {
    id,
    profileId,
    name: id,
    scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
    condition: {
      kind: ConditionNodeKind.Leaf,
      left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
      operator: NumericOperator.Gt,
      right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
    },
    trigger: { kind: TriggerKind.Once },
    expiration: null,
    actions: [
      {
        kind: ActionKind.SetSymbolState,
        key: 'trend',
        value: { type: StateValueType.Enum, value: 'up' },
      },
    ],
    enabled: true,
    order,
    events: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

/**
 * Build a rule that fires when its own profile's `state.trend === 'up'` and
 * sends a marker notification — used to detect cross-profile leakage.
 */
function readsTrendRule(profileId: string, id: string, marker: string, order: number): Rule {
  return {
    id,
    profileId,
    name: id,
    scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
    condition: {
      kind: ConditionNodeKind.Leaf,
      left: { kind: OperandKind.SymbolStateRef, key: 'trend', valueType: StateValueType.Enum },
      operator: StateOperator.Equals,
      right: {
        kind: OperandKind.Literal,
        value: { type: StateValueType.Enum, value: 'up' },
      },
    },
    trigger: { kind: TriggerKind.Once },
    expiration: null,
    actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: marker }],
    enabled: true,
    order,
    events: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

/**
 * End-to-end harness: a {@link QuoteRuleEventBridge} feeding a real
 * {@link RuleOrchestrator} backed by every in-memory adapter, with one
 * orchestrator per profile (the production wiring scopes the active profile
 * via `getActiveProfileId`).
 */
function buildDriver(seedRules: Rule[], activeProfile: string) {
  const notifier = new InMemoryNotifier(['main']);
  const log = new InMemoryEventLog(() => 999);
  const state = new InMemoryStateRepository();
  const firingState = new InMemoryFiringStateRepository();
  const rules = new InMemoryRuleRepository(seedRules);
  const watchlist = new InMemoryWatchlistRepository();
  const currentValues = new Map<string, number>();
  const symbolState = new Map<string, StateValue>();
  state.onStateChanged((event) => {
    if (event.scope.kind !== StateScope.Symbol) return;
    const slot = `${event.profileId}|${event.scope.symbolId}|${event.key}`;
    if (event.current === null) symbolState.delete(slot);
    else symbolState.set(slot, event.current);
  });
  const lookups: EvaluationLookups = {
    getCurrentValue: (id) => currentValues.get(id) ?? null,
    getOpenValue: () => null,
    getHighValue: () => null,
    getLowValue: () => null,
    getCloseValue: () => null,
    getVolumeValue: () => null,
    getIndicatorValue: () => null,
    getSymbolState: (profileId, id, key) => symbolState.get(`${profileId}|${id}|${key}`) ?? null,
    getGlobalState: () => null,
    getPrevCurrentValue: () => null,
    getPrevOpenValue: () => null,
    getPrevHighValue: () => null,
    getPrevLowValue: () => null,
    getPrevCloseValue: () => null,
    getPrevVolumeValue: () => null,
    getPrevIndicatorValue: () => null,
    getPrevSymbolState: () => null,
    getPrevGlobalState: () => null,
  };
  const orchestrator = new RuleOrchestrator(
    rules,
    watchlist,
    lookups,
    state,
    log,
    new TriggerEvaluator(log, firingState),
    new ActionRunner(state, notifier, lookups),
  );
  // `activeProfile` historically gated rule visibility via an orchestrator
  // option that no longer exists; profile binding is now driven by event
  // payload (#281) / the repository's enabled filter. The arg is kept on
  // `buildDriver()`'s signature so individual tests still feel readable.
  void activeProfile;
  let pending: Promise<void> = Promise.resolve();
  const bridge = new QuoteRuleEventBridge((event) => {
    pending = pending.then(() => orchestrator.process(event));
  });
  return {
    notifier,
    log,
    state,
    async push(q: SymbolQuoteEvent): Promise<void> {
      currentValues.set(q.id, q.quote.price);
      bridge.handleQuote(q);
      await pending;
    },
  };
}

describe('state profile binding (e2e)', () => {
  it('writes from a profile A rule land under profile A and are invisible to profile B', async () => {
    const driver = buildDriver([setTrendRule('profile-a', 'a-writer', 1)], 'profile-a');

    await driver.push(quote(100));

    expect(await driver.state.getSymbolState('profile-a', 'AAPL', 'trend')).toEqual({
      type: StateValueType.Enum,
      value: 'up',
    });
    expect(await driver.state.getSymbolState('profile-b', 'AAPL', 'trend')).toBeNull();
    const symbolEvents = await driver.log.symbolEvents('AAPL');
    const stateSets = symbolEvents.filter((event) => event.type === RuleEventType.StateSet);
    expect(stateSets).toEqual([
      {
        type: RuleEventType.StateSet,
        ts: 1000,
        ruleId: 'a-writer',
        symbolId: 'AAPL',
        scope: StateScope.Symbol,
        key: 'trend',
        value: { type: StateValueType.Enum, value: 'up' },
        firedAt: 999,
      },
    ]);
  });

  it("a cascaded state change in profile A does not wake profile B's downstream rule (the critical failure mode)", async () => {
    // Both profiles have a writer (fires on price > 0) and a reader (fires
    // on state.trend == 'up'). With the active-profile filter set to
    // profile-a, only profile-a's rules see the tick — but the cascade event
    // produced by the writer also has to STAY within profile-a or profile-b's
    // reader would react.
    const driver = buildDriver(
      [
        setTrendRule('profile-a', 'a-writer', 1),
        readsTrendRule('profile-a', 'a-reader', 'a-saw-it', 2),
        readsTrendRule('profile-b', 'b-reader', 'b-saw-it', 3),
      ],
      'profile-a',
    );

    await driver.push(quote(100));

    expect(driver.notifier.sent.map((sent) => sent.body)).toEqual(['a-saw-it']);
    expect(await driver.state.getSymbolState('profile-a', 'AAPL', 'trend')).toEqual({
      type: StateValueType.Enum,
      value: 'up',
    });
    expect(await driver.state.getSymbolState('profile-b', 'AAPL', 'trend')).toBeNull();
  });
});
