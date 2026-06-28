import {
  ActionKind,
  ConditionNodeKind,
  NumericOperator,
  OperandKind,
  type Rule,
  type RuleEvent,
  RuleScopeKind,
  StateValueType,
  SymbolType,
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
  MinuteTimerSource,
  RuleOrchestrator,
  TriggerEvaluator,
} from '@lametrader/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * E2e: real {@link MinuteTimerSource} wired into a {@link RuleOrchestrator}
 * with a `Once` rule keyed off the timer's `RuleEvent`. Uses fake timers
 * (real wall-clock would be flaky) and asserts the rule fires exactly once
 * across multiple advanced minutes.
 */

/** Baseline lookups that return null for everything. */
function emptyLookups(): EvaluationLookups {
  return {
    getCurrentValue: () => null,
    getOpenValue: () => null,
    getHighValue: () => null,
    getLowValue: () => null,
    getCloseValue: () => null,
    getVolumeValue: () => null,
    getIndicatorValue: () => null,
    getSymbolState: () => null,
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
}

/** An AllSymbols-scoped Once rule whose condition is `1 > 0` (always true). */
function timerRule(): Rule {
  return {
    id: 'tick',
    profileId: 'profile-1',
    name: 'tick',
    order: 1,
    scope: { kind: RuleScopeKind.AllSymbols },
    condition: {
      kind: ConditionNodeKind.Leaf,
      left: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 1 } },
      operator: NumericOperator.Gt,
      right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
    },
    trigger: { kind: TriggerKind.Once },
    expiration: null,
    actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'tick' }],
    enabled: true,
    events: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('minute timer (e2e)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires a Once rule exactly once across multiple minute boundaries', async () => {
    vi.setSystemTime(0);
    const notifier = new InMemoryNotifier(['main']);
    const watchlist = new InMemoryWatchlistRepository([
      {
        id: 'stock:AAPL',
        type: SymbolType.Stock,
        description: 'Apple',
        exchange: 'NMS',
        periods: [],
      },
    ]);
    const eventLog = new InMemoryEventLog();
    const state = new InMemoryStateRepository();
    const lookups = emptyLookups();
    const orchestrator = new RuleOrchestrator(
      new InMemoryRuleRepository([timerRule()]),
      watchlist,
      lookups,
      state,
      eventLog,
      new TriggerEvaluator(eventLog, new InMemoryFiringStateRepository()),
      new ActionRunner(state, notifier, lookups),
    );
    let pending: Promise<void> = Promise.resolve();
    const timer = new MinuteTimerSource(
      (event: RuleEvent) => {
        pending = pending.then(() => orchestrator.process(event));
      },
      () => Date.now(),
    );
    timer.start();

    await vi.advanceTimersByTimeAsync(60_000);
    await pending;
    const afterFirstBoundary = notifier.sent.length;

    await vi.advanceTimersByTimeAsync(2 * 60_000);
    await pending;
    timer.stop();

    expect(afterFirstBoundary).toBe(1);
    expect(notifier.sent).toEqual([{ destinationName: 'main', body: 'tick' }]);
  });
});
