import {
  ActionKind,
  ConditionNodeKind,
  NumericOperator,
  OperandKind,
  Period,
  type Rule,
  type RuleEvent,
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
  LiveEvaluationLookups,
  MinuteTimerSource,
  RuleOrchestrator,
  TriggerEvaluator,
} from '@lametrader/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * E2e for #330 — `RuleEventKind.Timer` cross-channel routing.
 *
 * A real {@link MinuteTimerSource} drives ticks into a real
 * {@link RuleOrchestrator}; tests use fake timers (a real wall clock would
 * be flaky) and assert:
 *
 *  - Timer-eligible rules (whose condition references state / literal
 *    operands only) fire on every tick within their trigger constraints;
 *  - OHLCV-bound rules are not woken by Timer events (no `OpenValueChanged`
 *    arrives, and the rule's condition reads from `lookups.getOpenValue`
 *    which stays `null` so the gate fails);
 *  - a Timer-fired upstream rule's `SetSymbolState` cascades into a
 *    downstream rule in the same `process()` tick.
 */

const AAPL = 'stock:AAPL';
const PROFILE_ID = 'profile-1';

const FLAG_TRUE = { type: StateValueType.Bool as const, value: true };
const ARMED_TRUE = { type: StateValueType.Bool as const, value: true };

interface Harness {
  rules: InMemoryRuleRepository;
  state: InMemoryStateRepository;
  notifier: InMemoryNotifier;
  eventLog: InMemoryEventLog;
  timer: MinuteTimerSource;
  awaitDrain: () => Promise<void>;
}

function buildHarness(seedRules: Rule[]): Harness {
  const rules = new InMemoryRuleRepository(seedRules);
  const watchlist = new InMemoryWatchlistRepository([
    {
      id: AAPL,
      type: SymbolType.Stock,
      description: 'Apple',
      exchange: 'NMS',
      periods: [Period.OneMinute],
    },
  ]);
  const state = new InMemoryStateRepository();
  const notifier = new InMemoryNotifier(['main']);
  const eventLog = new InMemoryEventLog(() => 999);
  const firingState = new InMemoryFiringStateRepository();
  const lookups = new LiveEvaluationLookups(state);
  const orchestrator = new RuleOrchestrator(
    rules,
    watchlist,
    lookups,
    state,
    notifier,
    eventLog,
    new TriggerEvaluator(eventLog, firingState),
  );
  let pending: Promise<void> = Promise.resolve();
  const timer = new MinuteTimerSource(
    (event: RuleEvent) => {
      lookups.record(event);
      pending = pending.then(() => orchestrator.process(event));
    },
    () => Date.now(),
  );
  return { rules, state, notifier, eventLog, timer, awaitDrain: () => pending };
}

async function fireCount(harness: Harness, ruleId: string): Promise<number> {
  const events = await harness.eventLog.ruleEvents(ruleId);
  return events.filter((event) => event.type === RuleEventType.Fired).length;
}

describe('minute timer cross-channel routing (e2e)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a Timer-eligible rule (condition: `gs(flag) == true`) fires on the minute boundary while the OHLCV-bound rule stays silent', async () => {
    vi.setSystemTime(0);
    const harness = buildHarness([
      {
        id: 'timer-rule',
        profileId: PROFILE_ID,
        name: 'timer-rule',
        scope: { kind: RuleScopeKind.AllSymbols },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.GlobalStateRef, key: 'flag', valueType: StateValueType.Bool },
          operator: StateOperator.Equals,
          right: { kind: OperandKind.Literal, value: FLAG_TRUE },
        },
        trigger: { kind: TriggerKind.Once },
        expiration: null,
        actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'tick' }],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 1,
      },
      {
        id: 'ohlcv-rule',
        profileId: PROFILE_ID,
        name: 'ohlcv-rule',
        scope: { kind: RuleScopeKind.Symbol, symbolId: AAPL },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.OpenValue, valueType: StateValueType.Number },
          operator: NumericOperator.Gt,
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
        },
        trigger: { kind: TriggerKind.Once },
        expiration: null,
        actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'ohlcv' }],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 2,
      },
    ]);
    await harness.state.setGlobalState(PROFILE_ID, 'flag', FLAG_TRUE, 0);
    harness.timer.start();

    await vi.advanceTimersByTimeAsync(60_000);
    await harness.awaitDrain();
    await vi.advanceTimersByTimeAsync(60_000);
    await harness.awaitDrain();
    harness.timer.stop();

    expect({
      notified: harness.notifier.sent,
      timerFires: await fireCount(harness, 'timer-rule'),
      ohlcvFires: await fireCount(harness, 'ohlcv-rule'),
    }).toEqual({
      // Timer rule is `Once` and AllSymbols-scoped — fires once on the first
      // tick, fans out to the watchlist's single symbol (AAPL), then
      // auto-disables. The OHLCV-bound rule cannot resolve `open` from a
      // Timer event (no `OpenValueChanged` arrives, lookups stay null) and
      // never fires.
      notified: [{ destinationName: 'main', body: 'tick' }],
      timerFires: 1,
      ohlcvFires: 0,
    });
  });

  it('Timer + cascade — a Timer-fired upstream rule sets `state.armed`, downstream rule fires on the cascade in the same tick', async () => {
    vi.setSystemTime(0);
    const harness = buildHarness([
      {
        id: 'timer-upstream',
        profileId: PROFILE_ID,
        name: 'timer-upstream',
        scope: { kind: RuleScopeKind.AllSymbols },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.GlobalStateRef, key: 'flag', valueType: StateValueType.Bool },
          operator: StateOperator.Equals,
          right: { kind: OperandKind.Literal, value: FLAG_TRUE },
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
        id: 'cascade-downstream',
        profileId: PROFILE_ID,
        name: 'cascade-downstream',
        scope: { kind: RuleScopeKind.Symbol, symbolId: AAPL },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.SymbolStateRef, key: 'armed', valueType: StateValueType.Bool },
          operator: StateOperator.Equals,
          right: { kind: OperandKind.Literal, value: ARMED_TRUE },
        },
        trigger: { kind: TriggerKind.Once },
        expiration: null,
        actions: [
          { kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'cascaded' },
        ],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 2,
      },
    ]);
    await harness.state.setGlobalState(PROFILE_ID, 'flag', FLAG_TRUE, 0);
    harness.timer.start();

    await vi.advanceTimersByTimeAsync(60_000);
    await harness.awaitDrain();
    harness.timer.stop();

    expect({
      notified: harness.notifier.sent,
      upstreamFires: await fireCount(harness, 'timer-upstream'),
      downstreamFires: await fireCount(harness, 'cascade-downstream'),
      stored: await harness.state.getSymbolState(PROFILE_ID, AAPL, 'armed'),
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'cascaded' }],
      upstreamFires: 1,
      downstreamFires: 1,
      stored: ARMED_TRUE,
    });
  });
});
