import type { EventLog } from '@lametrader/core';
import {
  ActionKind,
  ConditionNodeKind,
  NumericOperator,
  OperandKind,
  Period,
  ProfileScope,
  type Rule,
  RuleEventKind,
  RuleEventType,
  RuleScopeKind,
  StateOperator,
  StateValueType,
  SymbolType,
  TriggerKind,
} from '@lametrader/core';
import { afterEach, describe, expect, it } from 'vitest';
import { _resetLogRoot } from '../log.js';
import { InMemoryProfileRepository } from '../profiles/in-memory-profile-repository.js';
import { InMemoryStateRepository } from '../state/in-memory-state-repository.js';
import { InMemoryWatchlistRepository } from '../symbols/in-memory-watchlist-repository.js';
import type { EvaluationLookups } from './evaluation-context.types.js';
import { InMemoryEventLog } from './in-memory-event-log.js';
import { InMemoryFiringStateRepository } from './in-memory-firing-state-repository.js';
import { InMemoryNotifier } from './in-memory-notifier.js';
import { InMemoryRuleRepository } from './in-memory-rule-repository.js';
import { RuleOrchestrator } from './rule-orchestrator.js';
import { TriggerEvaluator } from './trigger-evaluator.js';

/**
 * Build an `[eventLog, triggers]` pair that shares the same `EventLog`
 * instance — needed because the trigger evaluator reads the rule's events
 * log to find prior `Fired` entries.
 */
function makeOrchestratorIo(now?: () => number): [InMemoryEventLog, TriggerEvaluator] {
  const eventLog = new InMemoryEventLog(now);
  return [eventLog, new TriggerEvaluator(eventLog, new InMemoryFiringStateRepository())];
}

/** Build a `TriggerEvaluator` over a caller-owned `EventLog`. */
function triggersFor(log: EventLog): TriggerEvaluator {
  return new TriggerEvaluator(log, new InMemoryFiringStateRepository());
}

afterEach(() => {
  _resetLogRoot();
});

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
  };
}

/** Build a minimally-valid rule with overrides. */
function rule(overrides: Partial<Rule> & Pick<Rule, 'id' | 'order'>): Rule {
  return {
    profileId: 'profile-1',
    name: overrides.id,
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
        kind: ActionKind.NotifyTelegram,
        destinationName: 'main',
        template: overrides.id,
      },
    ],
    enabled: true,
    events: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/** A CurrentValueChanged event that makes the baseline condition fire. */
function priceEvent(ts = 1000) {
  return {
    kind: RuleEventKind.CurrentValueChanged as const,
    ts,
    symbolId: 'AAPL',
    prev: null,
    current: 100,
    final: false,
  };
}

/** Lookups where AAPL's current value is 100 (matches `priceEvent`). */
function priceLookups(): EvaluationLookups {
  return {
    ...emptyLookups(),
    getCurrentValue: (id) => (id === 'AAPL' ? 100 : null),
  };
}

describe('RuleOrchestrator', () => {
  it('fires enabled rules in `order` against one event', async () => {
    const rules = new InMemoryRuleRepository([
      rule({ id: 'rule-b', order: 2 }),
      rule({ id: 'rule-a', order: 1 }),
    ]);
    const notifier = new InMemoryNotifier(['main']);
    const orchestrator = new RuleOrchestrator(
      rules,
      new InMemoryWatchlistRepository(),
      priceLookups(),
      new InMemoryStateRepository(),
      notifier,
      ...makeOrchestratorIo(),
    );

    await orchestrator.process(priceEvent());

    expect(notifier.sent.map((sent) => sent.body)).toEqual(['rule-a', 'rule-b']);
  });

  it('cascades state changes into downstream rules in the same tick', async () => {
    const trigger = rule({
      id: 'trigger',
      order: 1,
      actions: [
        {
          kind: ActionKind.SetSymbolState,
          key: 'armed',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
    });
    const downstream = rule({
      id: 'downstream',
      order: 2,
      condition: {
        kind: ConditionNodeKind.Leaf,
        left: { kind: OperandKind.SymbolStateRef, key: 'armed', valueType: StateValueType.Bool },
        operator: StateOperator.Equals,
        right: { kind: OperandKind.Literal, value: { type: StateValueType.Bool, value: true } },
      },
      actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'cascaded' }],
    });
    const rules = new InMemoryRuleRepository([trigger, downstream]);
    const state = new InMemoryStateRepository();
    // The lookups interface expects sync; bridge via a small Map updated by the cascade subscription.
    const stateCache = new Map<string, boolean>();
    state.onStateChanged((event) => {
      if (event.scope.kind === 'symbol' && event.current !== null) {
        stateCache.set(`${event.profileId}|${event.scope.symbolId}|${event.key}`, true);
      }
    });
    const syncLookups: EvaluationLookups = {
      ...priceLookups(),
      getSymbolState: (profileId, symbolId, key) =>
        stateCache.get(`${profileId}|${symbolId}|${key}`) === true
          ? { type: StateValueType.Bool, value: true }
          : null,
    };
    const notifier = new InMemoryNotifier(['main']);
    const orchestrator = new RuleOrchestrator(
      rules,
      new InMemoryWatchlistRepository(),
      syncLookups,
      state,
      notifier,
      ...makeOrchestratorIo(),
    );

    await orchestrator.process(priceEvent());

    expect(notifier.sent.map((sent) => sent.body)).toEqual(['cascaded']);
  });

  it('cascaded state changes only fire rules belonging to the originating profile (#281)', async () => {
    const triggerInP1 = rule({
      id: 'trigger',
      order: 1,
      profileId: 'profile-1',
      actions: [
        {
          kind: ActionKind.SetSymbolState,
          key: 'armed',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
    });
    const downstreamP1 = rule({
      id: 'downstream-p1',
      order: 2,
      profileId: 'profile-1',
      condition: {
        kind: ConditionNodeKind.Leaf,
        left: { kind: OperandKind.SymbolStateRef, key: 'armed', valueType: StateValueType.Bool },
        operator: StateOperator.Equals,
        right: { kind: OperandKind.Literal, value: { type: StateValueType.Bool, value: true } },
      },
      actions: [
        { kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'p1-saw-it' },
      ],
    });
    const downstreamP2 = rule({
      id: 'downstream-p2',
      order: 3,
      profileId: 'profile-2',
      condition: {
        kind: ConditionNodeKind.Leaf,
        left: { kind: OperandKind.SymbolStateRef, key: 'armed', valueType: StateValueType.Bool },
        operator: StateOperator.Equals,
        right: { kind: OperandKind.Literal, value: { type: StateValueType.Bool, value: true } },
      },
      actions: [
        { kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'p2-saw-it' },
      ],
    });
    const rules = new InMemoryRuleRepository([triggerInP1, downstreamP1, downstreamP2]);
    const state = new InMemoryStateRepository();
    const stateCache = new Map<string, boolean>();
    state.onStateChanged((event) => {
      if (event.scope.kind === 'symbol' && event.current !== null) {
        stateCache.set(`${event.profileId}|${event.scope.symbolId}|${event.key}`, true);
      }
    });
    const syncLookups: EvaluationLookups = {
      ...priceLookups(),
      getSymbolState: (profileId, symbolId, key) =>
        stateCache.get(`${profileId}|${symbolId}|${key}`) === true
          ? { type: StateValueType.Bool, value: true }
          : null,
    };
    const notifier = new InMemoryNotifier(['main']);
    const orchestrator = new RuleOrchestrator(
      rules,
      new InMemoryWatchlistRepository(),
      syncLookups,
      state,
      notifier,
      ...makeOrchestratorIo(),
      { getActiveProfileId: () => 'profile-1' },
    );

    await orchestrator.process(priceEvent());

    expect(notifier.sent.map((sent) => sent.body)).toEqual(['p1-saw-it']);
  });

  it('stops cascading and records one CycleOverflow event when the cycle limit is breached', async () => {
    // Two always-firing rules whose actions write distinct state keys; each
    // initial fire produces one cascade event, so the second cascade event's
    // `guard.enter()` (count=2) breaches a limit of 1 and the orchestrator
    // records exactly one CycleOverflow event before stopping.
    const a = rule({
      id: 'A',
      order: 1,
      actions: [
        {
          kind: ActionKind.SetSymbolState,
          key: 'a',
          value: { type: StateValueType.Number, value: 1 },
        },
      ],
    });
    const b = rule({
      id: 'B',
      order: 2,
      actions: [
        {
          kind: ActionKind.SetSymbolState,
          key: 'b',
          value: { type: StateValueType.Number, value: 1 },
        },
      ],
    });
    const rules = new InMemoryRuleRepository([a, b]);
    const log = new InMemoryEventLog(() => 999);
    const orchestrator = new RuleOrchestrator(
      rules,
      new InMemoryWatchlistRepository(),
      priceLookups(),
      new InMemoryStateRepository(),
      new InMemoryNotifier(),
      log,
      triggersFor(log),
      { cycleLimit: 1 },
    );

    await orchestrator.process(priceEvent());

    const events = await log.symbolEvents('AAPL');
    const overflows = events.filter((event) => event.type === RuleEventType.CycleOverflow);
    expect(overflows).toEqual([
      {
        type: RuleEventType.CycleOverflow,
        ts: 1000,
        ruleId: '',
        symbolId: 'AAPL',
        cycleLimit: 1,
        firedAt: 999,
      },
    ]);
  });

  it('auto-disables a Once rule after its first fire', async () => {
    const r = rule({ id: 'once', order: 1, trigger: { kind: TriggerKind.Once } });
    const rules = new InMemoryRuleRepository([r]);
    const orchestrator = new RuleOrchestrator(
      rules,
      new InMemoryWatchlistRepository(),
      priceLookups(),
      new InMemoryStateRepository(),
      new InMemoryNotifier(['main']),
      ...makeOrchestratorIo(),
    );

    await orchestrator.process(priceEvent());

    const stored = await rules.get('once');
    expect({ enabled: stored?.enabled }).toEqual({ enabled: false });
  });

  it('logs a warn entry when auto-disabling a Once rule after fire (#306)', async () => {
    const r = rule({ id: 'once', order: 1, trigger: { kind: TriggerKind.Once } });
    const rules = new InMemoryRuleRepository([r]);
    const records: Record<string, unknown>[] = [];
    _resetLogRoot({
      write: (line: string) => {
        records.push(JSON.parse(line));
      },
    });
    const orchestrator = new RuleOrchestrator(
      rules,
      new InMemoryWatchlistRepository(),
      priceLookups(),
      new InMemoryStateRepository(),
      new InMemoryNotifier(['main']),
      ...makeOrchestratorIo(),
    );

    await orchestrator.process(priceEvent());

    const warnEntries = records
      .filter((r) => r.level === 40)
      .map((r) => ({ scope: r.scope, msg: r.msg, ruleId: r.ruleId, symbolId: r.symbolId }));
    expect(warnEntries).toEqual([
      {
        scope: 'rule-orchestrator',
        msg: 'auto-disabled Once rule after fire',
        ruleId: 'once',
        symbolId: 'AAPL',
      },
    ]);
  });

  it('preserves the Fired event on the rule when auto-disabling a Once rule (issue #300)', async () => {
    // Reproduces the Mongo contract: `appendRuleEvent` `$push`-es onto the
    // rule doc itself. If the auto-disable branch saves a stale captured
    // `rule`, the `replaceOne` wipes the just-pushed Fired entry.
    const r = rule({ id: 'once', order: 1, trigger: { kind: TriggerKind.Once } });
    const rules = new InMemoryRuleRepository([r]);
    const baseLog = new InMemoryEventLog();
    const couplingLog = {
      async appendRuleEvent(ruleId: string, entry: Parameters<typeof baseLog.appendRuleEvent>[1]) {
        await baseLog.appendRuleEvent(ruleId, entry);
        const stored = await rules.get(ruleId);
        if (stored !== null) {
          await rules.save({ ...stored, events: [...stored.events, entry] });
        }
      },
      appendSymbolEvent: baseLog.appendSymbolEvent.bind(baseLog),
      ruleEvents: baseLog.ruleEvents.bind(baseLog),
      symbolEvents: baseLog.symbolEvents.bind(baseLog),
    };
    const orchestrator = new RuleOrchestrator(
      rules,
      new InMemoryWatchlistRepository(),
      priceLookups(),
      new InMemoryStateRepository(),
      new InMemoryNotifier(['main']),
      couplingLog,
      triggersFor(couplingLog),
    );

    await orchestrator.process(priceEvent());

    const stored = await rules.get('once');
    expect({
      enabled: stored?.enabled,
      eventTypes: stored?.events.map((e) => e.type) ?? [],
    }).toEqual({
      enabled: false,
      eventTypes: [RuleEventType.NotificationSent, RuleEventType.Fired],
    });
  });

  it('does not fire disabled rules', async () => {
    const r = rule({ id: 'off', order: 1, enabled: false });
    const notifier = new InMemoryNotifier(['main']);
    const orchestrator = new RuleOrchestrator(
      new InMemoryRuleRepository([r]),
      new InMemoryWatchlistRepository(),
      priceLookups(),
      new InMemoryStateRepository(),
      notifier,
      ...makeOrchestratorIo(),
    );
    await orchestrator.process(priceEvent());
    expect(notifier.sent).toEqual([]);
  });

  it('filters out Symbol-scoped rules whose symbolId does not match the event', async () => {
    const aapl = rule({
      id: 'aapl',
      order: 1,
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
    });
    const msft = rule({
      id: 'msft',
      order: 2,
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'MSFT' },
    });
    const notifier = new InMemoryNotifier(['main']);
    const orchestrator = new RuleOrchestrator(
      new InMemoryRuleRepository([aapl, msft]),
      new InMemoryWatchlistRepository(),
      priceLookups(),
      new InMemoryStateRepository(),
      notifier,
      ...makeOrchestratorIo(),
    );
    await orchestrator.process(priceEvent());
    expect(notifier.sent.map((sent) => sent.body)).toEqual(['aapl']);
  });

  it('AllSymbols-scoped rules fire on the event symbol', async () => {
    const all = rule({
      id: 'all',
      order: 1,
      scope: { kind: RuleScopeKind.AllSymbols },
    });
    const notifier = new InMemoryNotifier(['main']);
    const orchestrator = new RuleOrchestrator(
      new InMemoryRuleRepository([all]),
      new InMemoryWatchlistRepository(),
      priceLookups(),
      new InMemoryStateRepository(),
      notifier,
      ...makeOrchestratorIo(),
    );
    await orchestrator.process(priceEvent());
    expect(notifier.sent.map((sent) => sent.body)).toEqual(['all']);
  });

  it('runs actions in declaration order and records one Fired event after them', async () => {
    const r = rule({
      id: 'multi',
      order: 1,
      actions: [
        { kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'first' },
        { kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'second' },
      ],
    });
    const notifier = new InMemoryNotifier(['main']);
    const log = new InMemoryEventLog();
    const orchestrator = new RuleOrchestrator(
      new InMemoryRuleRepository([r]),
      new InMemoryWatchlistRepository(),
      priceLookups(),
      new InMemoryStateRepository(),
      notifier,
      log,
      triggersFor(log),
    );
    await orchestrator.process(priceEvent());
    expect(notifier.sent.map((sent) => sent.body)).toEqual(['first', 'second']);
    const fires = (await log.ruleEvents('multi')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    expect(fires.length).toBe(1);
  });

  it('treats expiration.at strictly greater than ts as still-active', async () => {
    const r = rule({ id: 'active', order: 1, expiration: { at: 1001 } });
    const notifier = new InMemoryNotifier(['main']);
    const orchestrator = new RuleOrchestrator(
      new InMemoryRuleRepository([r]),
      new InMemoryWatchlistRepository(),
      priceLookups(),
      new InMemoryStateRepository(),
      notifier,
      ...makeOrchestratorIo(),
    );
    await orchestrator.process(priceEvent(1000));
    expect(notifier.sent.map((sent) => sent.body)).toEqual(['active']);
  });

  it('OncePerMinute fires on a false→true transition across two events and is suppressed on the second false→true within the interval', async () => {
    // Condition: current value > 50. First event has current=100 (true), second is below threshold (false), third triggers transition again within 60s.
    const r = rule({
      id: 'flap',
      order: 1,
      trigger: { kind: TriggerKind.OncePerMinute, intervalMs: 60_000 },
      condition: {
        kind: ConditionNodeKind.Leaf,
        left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
        operator: NumericOperator.Gt,
        right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 50 } },
      },
    });
    let current = 100;
    const lookups: EvaluationLookups = {
      ...emptyLookups(),
      getCurrentValue: () => current,
    };
    const notifier = new InMemoryNotifier(['main']);
    const orchestrator = new RuleOrchestrator(
      new InMemoryRuleRepository([r]),
      new InMemoryWatchlistRepository(),
      lookups,
      new InMemoryStateRepository(),
      notifier,
      ...makeOrchestratorIo(),
    );

    await orchestrator.process({ ...priceEvent(0), current: 100 });
    current = 10;
    await orchestrator.process({ ...priceEvent(1000), current: 10 });
    current = 100;
    await orchestrator.process({ ...priceEvent(30_000), current: 100 });

    expect(notifier.sent.length).toBe(1);
  });

  it('skips a rule whose expiration has passed and emits one Expired event exactly once per symbol', async () => {
    const expired = rule({ id: 'expired', order: 1, expiration: { at: 500 } });
    const rules = new InMemoryRuleRepository([expired]);
    const notifier = new InMemoryNotifier(['main']);
    const log = new InMemoryEventLog(() => 999);
    const orchestrator = new RuleOrchestrator(
      rules,
      new InMemoryWatchlistRepository(),
      priceLookups(),
      new InMemoryStateRepository(),
      notifier,
      log,
      triggersFor(log),
    );

    await orchestrator.process(priceEvent(1000));
    await orchestrator.process(priceEvent(2000));

    expect(notifier.sent).toEqual([]);
    const expiredEvents = (await log.ruleEvents('expired')).filter(
      (event) => event.type === RuleEventType.Expired,
    );
    expect(expiredEvents).toEqual([
      {
        type: RuleEventType.Expired,
        ts: 1000,
        ruleId: 'expired',
        symbolId: 'AAPL',
        firedAt: 999,
      },
    ]);
  });

  it('fans an AllSymbols-scoped rule out across every watched symbol on a Timer event', async () => {
    const r = rule({
      id: 'timer-all',
      order: 1,
      scope: { kind: RuleScopeKind.AllSymbols },
      // Use a per-minute trigger so the fan-out isn't curtailed by the
      // `Once`-trigger auto-disable that stops at the first matching symbol.
      trigger: { kind: TriggerKind.OncePerMinute, intervalMs: 1 },
      condition: {
        kind: ConditionNodeKind.Leaf,
        left: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 1 } },
        operator: NumericOperator.Gt,
        right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
      },
      actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'tick' }],
    });
    const notifier = new InMemoryNotifier(['main']);
    const watchlist = new InMemoryWatchlistRepository([
      { id: 'AAPL', type: SymbolType.Stock, description: 'Apple', exchange: 'NMS', periods: [] },
      {
        id: 'MSFT',
        type: SymbolType.Stock,
        description: 'Microsoft',
        exchange: 'NMS',
        periods: [],
      },
    ]);
    const orchestrator = new RuleOrchestrator(
      new InMemoryRuleRepository([r]),
      watchlist,
      emptyLookups(),
      new InMemoryStateRepository(),
      notifier,
      ...makeOrchestratorIo(),
    );

    await orchestrator.process({ kind: RuleEventKind.Timer, ts: 1000, symbolId: null });

    expect(notifier.sent).toEqual([
      { destinationName: 'main', body: 'tick' },
      { destinationName: 'main', body: 'tick' },
    ]);
  });

  describe('mutually-exclusive Open-threshold rules on one candle (#312)', () => {
    /**
     * Build the BUY rule from the issue: Open >= 0.02634 ∧ signal != "BUY"
     * → SetSymbolState signal="BUY", OncePerBar(1m). String state type
     * matches the user's actual rule JSON.
     */
    function buyRule(): Rule {
      return rule({
        id: 'buy',
        order: 1,
        trigger: { kind: TriggerKind.OncePerBar, period: Period.OneMinute },
        condition: {
          kind: ConditionNodeKind.And,
          children: [
            {
              kind: ConditionNodeKind.Leaf,
              left: { kind: OperandKind.OpenValue, valueType: StateValueType.Number },
              operator: NumericOperator.Gte,
              right: {
                kind: OperandKind.Literal,
                value: { type: StateValueType.Number, value: 0.02634 },
              },
            },
            {
              kind: ConditionNodeKind.Leaf,
              left: {
                kind: OperandKind.SymbolStateRef,
                key: 'signal',
                valueType: StateValueType.String,
              },
              operator: StateOperator.NotEquals,
              right: {
                kind: OperandKind.Literal,
                value: { type: StateValueType.String, value: 'BUY' },
              },
            },
          ],
        },
        actions: [
          {
            kind: ActionKind.SetSymbolState,
            key: 'signal',
            value: { type: StateValueType.String, value: 'BUY' },
          },
        ],
      });
    }

    /**
     * The SELL rule from the issue: Open < 0.02634 ∧ signal != "SELL" →
     * SetSymbolState signal="SELL", OncePerBar(1m).
     */
    function sellRule(): Rule {
      return rule({
        id: 'sell',
        order: 2,
        trigger: { kind: TriggerKind.OncePerBar, period: Period.OneMinute },
        condition: {
          kind: ConditionNodeKind.And,
          children: [
            {
              kind: ConditionNodeKind.Leaf,
              left: { kind: OperandKind.OpenValue, valueType: StateValueType.Number },
              operator: NumericOperator.Lt,
              right: {
                kind: OperandKind.Literal,
                value: { type: StateValueType.Number, value: 0.02634 },
              },
            },
            {
              kind: ConditionNodeKind.Leaf,
              left: {
                kind: OperandKind.SymbolStateRef,
                key: 'signal',
                valueType: StateValueType.String,
              },
              operator: StateOperator.NotEquals,
              right: {
                kind: OperandKind.Literal,
                value: { type: StateValueType.String, value: 'SELL' },
              },
            },
          ],
        },
        actions: [
          {
            kind: ActionKind.SetSymbolState,
            key: 'signal',
            value: { type: StateValueType.String, value: 'SELL' },
          },
        ],
      });
    }

    /**
     * Wire state + a state-cache mirror via `onStateChanged`, just like the
     * live wiring. Pre-seed `signal=<initial>` so the BUY/SELL `!=` leaves
     * have a non-null `current` to compare.
     */
    async function buildStateWithSignal(initial: 'BUY' | 'SELL') {
      const state = new InMemoryStateRepository();
      await state.setSymbolState(
        'profile-1',
        'AAPL',
        'signal',
        { type: StateValueType.String, value: initial },
        999_000,
      );
      const stateCache = new Map<string, StateValue>([
        ['profile-1|AAPL|signal', { type: StateValueType.String, value: initial }],
      ]);
      state.onStateChanged((event) => {
        if (event.scope.kind === 'symbol' && event.current !== null) {
          stateCache.set(`${event.profileId}|${event.scope.symbolId}|${event.key}`, event.current);
        }
      });
      return { state, stateCache };
    }

    it('cascade leaves at most one Fired per bar when the live cache is fresh (signal=BUY pre-state, Open drops to 0.02633)', async () => {
      // Sane wiring: cache reflects bar N+1's open before process() runs.
      // BUY can't fire (signal=BUY); SELL fires once, cascade re-evals SELL
      // and OncePerBar suppresses the second fire.
      const { state, stateCache } = await buildStateWithSignal('BUY');
      const lookups: EvaluationLookups = {
        ...emptyLookups(),
        getOpenValue: (id) => (id === 'AAPL' ? 0.02633 : null),
        getSymbolState: (profileId, symbolId, key) =>
          stateCache.get(`${profileId}|${symbolId}|${key}`) ?? null,
      };
      const log = new InMemoryEventLog();
      const orchestrator = new RuleOrchestrator(
        new InMemoryRuleRepository([buyRule(), sellRule()]),
        new InMemoryWatchlistRepository(),
        lookups,
        state,
        new InMemoryNotifier(['main']),
        log,
        triggersFor(log),
      );

      const barOpenTs = 1_000_000;
      await orchestrator.process({
        kind: RuleEventKind.OpenValueChanged,
        ts: barOpenTs,
        symbolId: 'AAPL',
        prev: 0.02634,
        current: 0.02633,
        final: false,
      });

      const fired = (await log.symbolEvents('AAPL')).filter(
        (event) => event.type === RuleEventType.Fired,
      );
      expect(fired.map(({ firedAt: _firedAt, context: _context, ...rest }) => rest)).toEqual([
        { type: RuleEventType.Fired, ts: barOpenTs, ruleId: 'sell', symbolId: 'AAPL' },
      ]);
    });

    it('uses the inbound `OpenValueChanged.current` for OpenValue operands so a stale Open cache cannot fire BUY on a 0.02633 bar', async () => {
      // The bug from #312: prior bar set signal=BUY, then SELL fired and set
      // signal=SELL; the new bar's open is 0.02633 but the live cache hasn't
      // caught up (still 0.02634). On the inbound OpenValueChanged for this
      // bar, BUY's `Open >= 0.02634` must NOT resolve via the stale lookup —
      // it has to read `event.current=0.02633` directly. signal=SELL then
      // blocks SELL too, so no rule fires on this candle.
      const { state, stateCache } = await buildStateWithSignal('SELL');
      const lookups: EvaluationLookups = {
        ...emptyLookups(),
        // Stale: the live cache still holds the prior bar's open value.
        getOpenValue: (id) => (id === 'AAPL' ? 0.02634 : null),
        getSymbolState: (profileId, symbolId, key) =>
          stateCache.get(`${profileId}|${symbolId}|${key}`) ?? null,
      };
      const log = new InMemoryEventLog();
      const orchestrator = new RuleOrchestrator(
        new InMemoryRuleRepository([buyRule(), sellRule()]),
        new InMemoryWatchlistRepository(),
        lookups,
        state,
        new InMemoryNotifier(['main']),
        log,
        triggersFor(log),
      );

      const barOpenTs = 1_000_000;
      await orchestrator.process({
        kind: RuleEventKind.OpenValueChanged,
        ts: barOpenTs,
        symbolId: 'AAPL',
        prev: 0.02634,
        current: 0.02633,
        final: false,
      });

      const fired = (await log.symbolEvents('AAPL')).filter(
        (event) => event.type === RuleEventType.Fired,
      );
      expect(fired).toEqual([]);
    });
  });

  it('fires every enabled rule across enabled profiles on a non-cascade event', async () => {
    const profiles = new InMemoryProfileRepository([
      {
        id: 'profile-1',
        name: 'p1',
        description: '',
        enabled: true,
        scope: { type: ProfileScope.All },
        indicators: [],
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: 'profile-2',
        name: 'p2',
        description: '',
        enabled: true,
        scope: { type: ProfileScope.All },
        indicators: [],
        createdAt: 0,
        updatedAt: 0,
      },
    ]);
    const p1Rule = rule({ id: 'p1', order: 1, profileId: 'profile-1' });
    const p2Rule = rule({ id: 'p2', order: 1, profileId: 'profile-2' });
    const notifier = new InMemoryNotifier(['main']);
    const orchestrator = new RuleOrchestrator(
      new InMemoryRuleRepository([p1Rule, p2Rule], profiles),
      new InMemoryWatchlistRepository(),
      priceLookups(),
      new InMemoryStateRepository(),
      notifier,
      ...makeOrchestratorIo(),
    );

    await orchestrator.process(priceEvent());

    expect(notifier.sent.map((sent) => sent.body)).toEqual(['p1', 'p2']);
  });

  it('does not fire a rule whose parent profile is disabled', async () => {
    const profiles = new InMemoryProfileRepository([
      {
        id: 'profile-on',
        name: 'on',
        description: '',
        enabled: true,
        scope: { type: ProfileScope.All },
        indicators: [],
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: 'profile-off',
        name: 'off',
        description: '',
        enabled: false,
        scope: { type: ProfileScope.All },
        indicators: [],
        createdAt: 0,
        updatedAt: 0,
      },
    ]);
    const onRule = rule({ id: 'on', order: 1, profileId: 'profile-on' });
    const offRule = rule({ id: 'off', order: 2, profileId: 'profile-off' });
    const notifier = new InMemoryNotifier(['main']);
    const orchestrator = new RuleOrchestrator(
      new InMemoryRuleRepository([onRule, offRule], profiles),
      new InMemoryWatchlistRepository(),
      priceLookups(),
      new InMemoryStateRepository(),
      notifier,
      ...makeOrchestratorIo(),
    );

    await orchestrator.process(priceEvent());

    expect(notifier.sent.map((sent) => sent.body)).toEqual(['on']);
  });
});
