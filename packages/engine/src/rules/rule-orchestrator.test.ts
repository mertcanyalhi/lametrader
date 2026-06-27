import {
  ActionKind,
  ConditionNodeKind,
  NumericOperator,
  OperandKind,
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
import { describe, expect, it } from 'vitest';

import { InMemoryProfileRepository } from '../profiles/in-memory-profile-repository.js';
import { InMemoryStateRepository } from '../state/in-memory-state-repository.js';
import { InMemoryWatchlistRepository } from '../symbols/in-memory-watchlist-repository.js';
import type { EvaluationLookups } from './evaluation-context.types.js';
import { InMemoryEventLog } from './in-memory-event-log.js';
import { InMemoryFiringStateRepository } from './in-memory-firing-state-repository.js';
import { InMemoryNotifier } from './in-memory-notifier.js';
import { InMemoryRuleRepository } from './in-memory-rule-repository.js';
import { RuleOrchestrator } from './rule-orchestrator.js';

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
      new InMemoryEventLog(),
      new InMemoryFiringStateRepository(),
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
      new InMemoryEventLog(),
      new InMemoryFiringStateRepository(),
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
      new InMemoryEventLog(),
      new InMemoryFiringStateRepository(),
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
    const log = new InMemoryEventLog();
    const orchestrator = new RuleOrchestrator(
      rules,
      new InMemoryWatchlistRepository(),
      priceLookups(),
      new InMemoryStateRepository(),
      new InMemoryNotifier(),
      log,
      new InMemoryFiringStateRepository(),
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
      new InMemoryEventLog(),
      new InMemoryFiringStateRepository(),
    );

    await orchestrator.process(priceEvent());

    const stored = await rules.get('once');
    expect({ enabled: stored?.enabled }).toEqual({ enabled: false });
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
      new InMemoryEventLog(),
      new InMemoryFiringStateRepository(),
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
      new InMemoryEventLog(),
      new InMemoryFiringStateRepository(),
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
      new InMemoryEventLog(),
      new InMemoryFiringStateRepository(),
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
      new InMemoryFiringStateRepository(),
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
      new InMemoryEventLog(),
      new InMemoryFiringStateRepository(),
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
      new InMemoryEventLog(),
      new InMemoryFiringStateRepository(),
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
    const log = new InMemoryEventLog();
    const orchestrator = new RuleOrchestrator(
      rules,
      new InMemoryWatchlistRepository(),
      priceLookups(),
      new InMemoryStateRepository(),
      notifier,
      log,
      new InMemoryFiringStateRepository(),
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
      new InMemoryEventLog(),
      new InMemoryFiringStateRepository(),
    );

    await orchestrator.process({ kind: RuleEventKind.Timer, ts: 1000, symbolId: null });

    expect(notifier.sent).toEqual([
      { destinationName: 'main', body: 'tick' },
      { destinationName: 'main', body: 'tick' },
    ]);
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
      new InMemoryEventLog(),
      new InMemoryFiringStateRepository(),
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
      new InMemoryEventLog(),
      new InMemoryFiringStateRepository(),
    );

    await orchestrator.process(priceEvent());

    expect(notifier.sent.map((sent) => sent.body)).toEqual(['on']);
  });
});
