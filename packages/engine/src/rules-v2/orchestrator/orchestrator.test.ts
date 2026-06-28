import {
  Period,
  RulesV2,
  type StateRepository,
  StateScope,
  StateValueType,
  SymbolType,
  type WatchlistRepository,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import type { EvaluationLookups } from '../../rules/evaluation-context.types.js';
import { InMemoryNotifier } from '../../rules/in-memory-notifier.js';
import { InMemoryStateRepository } from '../../state/in-memory-state-repository.js';
import { InMemoryWatchlistRepository } from '../../symbols/in-memory-watchlist-repository.js';
import { TriggerDispatcher } from '../dispatch/dispatcher.js';
import { InMemoryRuleRepository } from '../dispatch/in-memory-rule-repository.js';
import { buildEvaluationContext } from '../evaluation-context.js';
import type { EvaluationContext } from '../evaluation-context.types.js';
import { IndicatorSeriesStore } from '../indicator-series-store.js';
import { TickRing } from '../tick-ring.js';
import { ActionRunner } from './action-runner.js';
import { InMemoryEventLog } from './in-memory-event-log.js';
import { RuleOrchestrator } from './orchestrator.js';

const PROFILE_A = 'profile-A';
const PROFILE_B = 'profile-B';

/**
 * Fixed-output `EvaluationLookups` — returns a constant `current` for every
 * symbol, `null` otherwise. Used by the orchestrator tests that don't care
 * about real OHLCV.
 */
function fixedLookups(current: number): EvaluationLookups {
  return {
    getCurrentValue: () => current,
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

/**
 * A Price > 100 leaf used by most orchestrator tests.
 */
const PRICE_GT_100: RulesV2.ConditionNode = {
  kind: RulesV2.ConditionNodeKind.Leaf,
  leaf: {
    family: RulesV2.LeafConditionFamily.Comparison,
    operator: RulesV2.ComparisonOperator.Gt,
    left: { kind: RulesV2.OperandKind.Price },
    right: {
      kind: RulesV2.OperandKind.Literal,
      value: { type: StateValueType.Number, value: 100 },
    },
  },
};

/** Build a Rule with sensible defaults the tests override field-by-field. */
function ruleWith(overrides: Partial<RulesV2.Rule> & Pick<RulesV2.Rule, 'id'>): RulesV2.Rule {
  return {
    profileId: PROFILE_A,
    name: 'Test',
    scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'AAPL' },
    condition: PRICE_GT_100,
    trigger: { kind: RulesV2.TriggerKind.EveryTime },
    expiration: null,
    actions: [
      {
        kind: RulesV2.ActionKind.Notification,
        channel: RulesV2.NotificationChannel.Telegram,
        destinationName: 'main',
        template: 'fired',
      },
    ],
    enabled: true,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/** Compose every orchestrator dep on top of in-memory infra. */
async function buildOrchestrator(opts: {
  rules: RulesV2.Rule[];
  notifier?: InMemoryNotifier;
  state?: StateRepository;
  watchlist?: WatchlistRepository;
  lookups?: EvaluationLookups;
  tickRings?: ReadonlyMap<string, TickRing>;
  now?: () => number;
}): Promise<{
  orchestrator: RuleOrchestrator;
  notifier: InMemoryNotifier;
  state: StateRepository;
  rules: RulesV2.RuleRepository;
  eventLog: InMemoryEventLog;
  watchlist: WatchlistRepository;
}> {
  const repo = new InMemoryRuleRepository();
  for (const r of opts.rules) await repo.save(r);
  const state = opts.state ?? new InMemoryStateRepository();
  const notifier = opts.notifier ?? new InMemoryNotifier(['main']);
  const lookups = opts.lookups ?? fixedLookups(120);
  const watchlist = opts.watchlist ?? new InMemoryWatchlistRepository();
  const eventLog = new InMemoryEventLog(opts.now ?? (() => 9_999));
  // Default tick ring per rule's firing symbol, seeded at price 120 so a
  // Price > 100 condition evaluates true. Tests that need specific tick
  // data override `tickRings` directly.
  const defaultRings = new Map<string, TickRing>();
  for (const r of opts.rules) {
    const ids =
      r.scope.kind === RulesV2.RuleScopeKind.Symbol
        ? [r.scope.symbolId]
        : r.scope.kind === RulesV2.RuleScopeKind.Symbols
          ? r.scope.symbolIds
          : [];
    for (const id of ids) {
      if (defaultRings.has(id)) continue;
      const ring = new TickRing();
      ring.push(0, 120);
      defaultRings.set(id, ring);
    }
  }
  const tickRings = opts.tickRings ?? defaultRings;
  const indicatorStore = new IndicatorSeriesStore();
  const buildContext = (event: RulesV2.RuleEvent, firingSymbolId: string): EvaluationContext =>
    buildEvaluationContext({
      symbolId: firingSymbolId,
      profileId: lookupProfile(repo, event),
      candleRepository: null as unknown as never,
      tickRings,
      indicatorStore,
      barWindow: { from: 0, to: Number.MAX_SAFE_INTEGER },
      getSymbolState: (profileId, symbolId, key) =>
        lookups.getSymbolState(profileId, symbolId, key),
      getGlobalState: (profileId, key) => lookups.getGlobalState(profileId, key),
    });
  const dispatcher = new TriggerDispatcher({ rules: repo, buildContext });
  const actions = new ActionRunner(state, notifier, lookups);
  const orchestrator = new RuleOrchestrator({
    rules: repo,
    state,
    watchlist,
    dispatcher,
    actions,
    eventLog,
  });
  return { orchestrator, notifier, state, rules: repo, eventLog, watchlist };
}

/**
 * For cascade events the dispatcher passes `event.profileId` as the scope
 * filter, so the orchestrator's `buildContext` needs to inspect the rule for
 * the matching profile.
 * The orchestrator test fixture's `buildContext` is a `(event, symbolId) →
 * context`; we don't have the rule here, so use the cascade event's
 * profileId when present and otherwise default to profile-A. The tests that
 * read state from the context cover only the cascade path so this fixture is
 * sufficient.
 */
function lookupProfile(_repo: RulesV2.RuleRepository, event: RulesV2.RuleEvent): string {
  if (
    event.kind === RulesV2.EvaluationTriggerKind.SymbolStateChanged ||
    event.kind === RulesV2.EvaluationTriggerKind.GlobalStateChanged
  ) {
    return event.profileId;
  }
  return PROFILE_A;
}

const TICK_AT = (ts: number, symbolId = 'AAPL'): RulesV2.TickEvent => ({
  kind: RulesV2.EvaluationTriggerKind.Tick,
  ts,
  symbolId,
  price: 120,
});

const TICK_EVENT = TICK_AT(1_000);

describe('RuleOrchestrator', () => {
  it('a Tick on an EveryTime Price > 100 rule fires once and appends [NotificationSent, Fired] to both the rule log and the symbol log', async () => {
    const { orchestrator, notifier, eventLog } = await buildOrchestrator({
      rules: [ruleWith({ id: 'r1' })],
    });
    await orchestrator.process(TICK_EVENT);
    const symbolEvents = await eventLog.symbolEvents('AAPL');
    const ruleEvents = await eventLog.ruleEvents('r1');
    const expectedNotification = {
      type: RulesV2.RuleEventType.NotificationSent,
      ts: 1_000,
      firedAt: 9_999,
      ruleId: 'r1',
      symbolId: 'AAPL',
      destinationName: 'main',
      body: 'fired',
    };
    const expectedFired = {
      type: RulesV2.RuleEventType.Fired,
      ts: 1_000,
      firedAt: 9_999,
      ruleId: 'r1',
      symbolId: 'AAPL',
      context: {
        inboundEvent: TICK_EVENT,
        lookupSnapshot: {
          current: 120,
          open: null,
          high: null,
          low: null,
          close: null,
          volume: null,
        },
      },
    };
    expect(notifier.sent).toEqual([{ destinationName: 'main', body: 'fired' }]);
    expect(symbolEvents).toEqual([expectedNotification, expectedFired]);
    expect(ruleEvents).toEqual([expectedNotification, expectedFired]);
  });

  it('Once trigger: after the first fire the rule is saved back to the repository with enabled: false', async () => {
    const { orchestrator, rules } = await buildOrchestrator({
      rules: [ruleWith({ id: 'r1', trigger: { kind: RulesV2.TriggerKind.Once } })],
    });
    await orchestrator.process(TICK_EVENT);
    const persisted = await rules.get('r1');
    expect(persisted).toEqual({
      ...ruleWith({ id: 'r1', trigger: { kind: RulesV2.TriggerKind.Once } }),
      enabled: false,
    });
  });

  it('OncePerBar trigger: a burst of three ticks within the same bar fires the rule exactly once', async () => {
    const { orchestrator, notifier } = await buildOrchestrator({
      rules: [
        ruleWith({
          id: 'r1',
          trigger: { kind: RulesV2.TriggerKind.OncePerBar, period: Period.OneMinute },
        }),
      ],
    });
    await orchestrator.process(TICK_AT(1_000));
    await orchestrator.process(TICK_AT(2_000));
    await orchestrator.process(TICK_AT(3_000));
    expect(notifier.sent).toEqual([{ destinationName: 'main', body: 'fired' }]);
  });

  it('state-mutation action cascades into a downstream rule whose condition reads the mutated state key, within the same process() call', async () => {
    const downstream: RulesV2.Rule = ruleWith({
      id: 'downstream',
      order: 1,
      condition: {
        kind: RulesV2.ConditionNodeKind.Leaf,
        leaf: {
          family: RulesV2.LeafConditionFamily.State,
          operator: RulesV2.StateOperator.Equals,
          left: {
            kind: RulesV2.OperandKind.SymbolStateRef,
            key: 'armed',
            valueType: StateValueType.Bool,
          },
          right: {
            kind: RulesV2.OperandKind.Literal,
            value: { type: StateValueType.Bool, value: true },
          },
        },
      },
      actions: [
        {
          kind: RulesV2.ActionKind.Notification,
          channel: RulesV2.NotificationChannel.Telegram,
          destinationName: 'main',
          template: 'downstream-fired',
        },
      ],
    });
    const upstream: RulesV2.Rule = ruleWith({
      id: 'upstream',
      order: 0,
      actions: [
        {
          kind: RulesV2.ActionKind.SetSymbolState,
          key: 'armed',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
    });
    // Live state mirror — every state write feeds a sync cache the lookups
    // read. The orchestrator's evaluation context for the cascaded
    // SymbolStateChanged event reads the freshly-written value.
    const state = new InMemoryStateRepository();
    const mirror = new Map<string, import('@lametrader/core').StateValue>();
    state.onStateChanged((event) => {
      const key = `${event.profileId}|${event.scope.kind === StateScope.Symbol ? `S:${event.scope.symbolId}` : 'G'}|${event.key}`;
      if (event.current === null) mirror.delete(key);
      else mirror.set(key, event.current);
    });
    const lookups: EvaluationLookups = {
      getCurrentValue: () => 120,
      getOpenValue: () => null,
      getHighValue: () => null,
      getLowValue: () => null,
      getCloseValue: () => null,
      getVolumeValue: () => null,
      getIndicatorValue: () => null,
      getSymbolState: (profileId, symbolId, key) =>
        mirror.get(`${profileId}|S:${symbolId}|${key}`) ?? null,
      getGlobalState: (profileId, key) => mirror.get(`${profileId}|G|${key}`) ?? null,
    };
    const { orchestrator, notifier } = await buildOrchestrator({
      rules: [upstream, downstream],
      state,
      lookups,
    });
    await orchestrator.process(TICK_EVENT);
    expect(notifier.sent).toEqual([{ destinationName: 'main', body: 'downstream-fired' }]);
  });

  it('multi-profile fan-out: a Tick with one matching rule on profile A and one on profile B fires both rules', async () => {
    const ruleA = ruleWith({
      id: 'A',
      profileId: PROFILE_A,
      actions: [
        {
          kind: RulesV2.ActionKind.Notification,
          channel: RulesV2.NotificationChannel.Telegram,
          destinationName: 'main',
          template: 'A',
        },
      ],
    });
    const ruleB = ruleWith({
      id: 'B',
      profileId: PROFILE_B,
      actions: [
        {
          kind: RulesV2.ActionKind.Notification,
          channel: RulesV2.NotificationChannel.Telegram,
          destinationName: 'main',
          template: 'B',
        },
      ],
    });
    const { orchestrator, notifier, eventLog } = await buildOrchestrator({
      rules: [ruleA, ruleB],
    });
    await orchestrator.process(TICK_EVENT);
    expect(notifier.sent).toEqual([
      { destinationName: 'main', body: 'A' },
      { destinationName: 'main', body: 'B' },
    ]);
    const aEvents = await eventLog.ruleEvents('A');
    const bEvents = await eventLog.ruleEvents('B');
    expect(aEvents.map((e) => e.type)).toEqual([
      RulesV2.RuleEventType.NotificationSent,
      RulesV2.RuleEventType.Fired,
    ]);
    expect(bEvents.map((e) => e.type)).toEqual([
      RulesV2.RuleEventType.NotificationSent,
      RulesV2.RuleEventType.Fired,
    ]);
  });

  it('AllSymbols scope on a Timer event fires the rule once per watched symbol', async () => {
    const watchlist = new InMemoryWatchlistRepository();
    await watchlist.add({
      id: 'AAPL',
      type: SymbolType.Stock,
      description: 'Apple',
      exchange: 'NMS',
      periods: [Period.OneMinute],
    });
    await watchlist.add({
      id: 'MSFT',
      type: SymbolType.Stock,
      description: 'Microsoft',
      exchange: 'NMS',
      periods: [Period.OneMinute],
    });
    const ringByName = new Map<string, TickRing>();
    for (const id of ['AAPL', 'MSFT']) {
      const ring = new TickRing();
      ring.push(0, 120);
      ringByName.set(id, ring);
    }
    const { orchestrator, eventLog } = await buildOrchestrator({
      rules: [
        ruleWith({
          id: 'all',
          scope: { kind: RulesV2.RuleScopeKind.AllSymbols },
          trigger: { kind: RulesV2.TriggerKind.OncePerInterval, intervalMs: 60_000 },
        }),
      ],
      watchlist,
      tickRings: ringByName,
    });
    const timer: RulesV2.TimerEvent = {
      kind: RulesV2.EvaluationTriggerKind.Timer,
      ts: 1_000,
    };
    await orchestrator.process(timer);
    const aaplFires = (await eventLog.symbolEvents('AAPL')).filter(
      (e) => e.type === RulesV2.RuleEventType.Fired,
    );
    const msftFires = (await eventLog.symbolEvents('MSFT')).filter(
      (e) => e.type === RulesV2.RuleEventType.Fired,
    );
    expect(aaplFires.length).toEqual(1);
    expect(msftFires.length).toEqual(1);
  });

  it('Symbols(list) scope on a Timer event fires the rule once per symbol in scope.symbolIds', async () => {
    const watchlist = new InMemoryWatchlistRepository();
    await watchlist.add({
      id: 'AAPL',
      type: SymbolType.Stock,
      description: 'Apple',
      exchange: 'NMS',
      periods: [Period.OneMinute],
    });
    await watchlist.add({
      id: 'MSFT',
      type: SymbolType.Stock,
      description: 'Microsoft',
      exchange: 'NMS',
      periods: [Period.OneMinute],
    });
    await watchlist.add({
      id: 'GOOG',
      type: SymbolType.Stock,
      description: 'Google',
      exchange: 'NMS',
      periods: [Period.OneMinute],
    });
    const ringByName = new Map<string, TickRing>();
    for (const id of ['AAPL', 'MSFT', 'GOOG']) {
      const ring = new TickRing();
      ring.push(0, 120);
      ringByName.set(id, ring);
    }
    const { orchestrator, eventLog } = await buildOrchestrator({
      rules: [
        ruleWith({
          id: 'multi',
          scope: { kind: RulesV2.RuleScopeKind.Symbols, symbolIds: ['AAPL', 'MSFT'] },
          trigger: { kind: RulesV2.TriggerKind.OncePerInterval, intervalMs: 60_000 },
        }),
      ],
      watchlist,
      tickRings: ringByName,
    });
    const timer: RulesV2.TimerEvent = {
      kind: RulesV2.EvaluationTriggerKind.Timer,
      ts: 1_000,
    };
    await orchestrator.process(timer);
    const aaplFires = (await eventLog.symbolEvents('AAPL')).filter(
      (e) => e.type === RulesV2.RuleEventType.Fired,
    );
    const msftFires = (await eventLog.symbolEvents('MSFT')).filter(
      (e) => e.type === RulesV2.RuleEventType.Fired,
    );
    const googFires = (await eventLog.symbolEvents('GOOG')).filter(
      (e) => e.type === RulesV2.RuleEventType.Fired,
    );
    expect(aaplFires.length).toEqual(1);
    expect(msftFires.length).toEqual(1);
    expect(googFires.length).toEqual(0);
  });

  it('a cycle overflow during cascade emits exactly one CycleOverflow entry and halts further cascade', async () => {
    // Setup that ping-pongs forever: a kicker rule fires on the Tick and
    // sets 'flag'; a flipper rule's condition reads 'flag' (so the cascade
    // routes back to it) and its action overwrites 'flag' with an
    // alternating value (so each write is observable, since no-op writes
    // are suppressed).
    const state = new InMemoryStateRepository();
    const mirror = new Map<string, import('@lametrader/core').StateValue>();
    state.onStateChanged((event) => {
      const key = `${event.profileId}|S:${event.scope.kind === StateScope.Symbol ? event.scope.symbolId : ''}|${event.key}`;
      if (event.current === null) mirror.delete(key);
      else mirror.set(key, event.current);
    });
    const lookups: EvaluationLookups = {
      getCurrentValue: () => 120,
      getOpenValue: () => null,
      getHighValue: () => null,
      getLowValue: () => null,
      getCloseValue: () => null,
      getVolumeValue: () => null,
      getIndicatorValue: () => null,
      getSymbolState: (profileId, symbolId, key) =>
        mirror.get(`${profileId}|S:${symbolId}|${key}`) ?? null,
      getGlobalState: () => null,
    };
    // Wrap setSymbolState so the flipper's write alternates Bool values per
    // call — the in-memory repo suppresses identical-value writes, so we
    // need each one to mutate the cache.
    let next = false;
    const wrapped: StateRepository = {
      ...state,
      listSymbolState: state.listSymbolState.bind(state),
      getSymbolState: state.getSymbolState.bind(state),
      listGlobalState: state.listGlobalState.bind(state),
      getGlobalState: state.getGlobalState.bind(state),
      removeSymbolState: state.removeSymbolState.bind(state),
      setGlobalState: state.setGlobalState.bind(state),
      removeGlobalState: state.removeGlobalState.bind(state),
      onStateChanged: state.onStateChanged.bind(state),
      setSymbolState: (profileId, symbolId, key, value, ts) => {
        if (key !== 'flag') return state.setSymbolState(profileId, symbolId, key, value, ts);
        const v: import('@lametrader/core').StateValue = {
          type: StateValueType.Bool,
          value: next,
        };
        next = !next;
        return state.setSymbolState(profileId, symbolId, key, v, ts);
      },
    };
    const kicker: RulesV2.Rule = ruleWith({
      id: 'kicker',
      order: 0,
      actions: [
        {
          kind: RulesV2.ActionKind.SetSymbolState,
          key: 'flag',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
    });
    // The flipper's condition covers BOTH true and false so the cascade
    // always re-fires regardless of which value the wrapper wrote.
    const flipper: RulesV2.Rule = ruleWith({
      id: 'flipper',
      order: 1,
      condition: {
        kind: RulesV2.ConditionNodeKind.Or,
        children: [
          {
            kind: RulesV2.ConditionNodeKind.Leaf,
            leaf: {
              family: RulesV2.LeafConditionFamily.State,
              operator: RulesV2.StateOperator.Equals,
              left: {
                kind: RulesV2.OperandKind.SymbolStateRef,
                key: 'flag',
                valueType: StateValueType.Bool,
              },
              right: {
                kind: RulesV2.OperandKind.Literal,
                value: { type: StateValueType.Bool, value: true },
              },
            },
          },
          {
            kind: RulesV2.ConditionNodeKind.Leaf,
            leaf: {
              family: RulesV2.LeafConditionFamily.State,
              operator: RulesV2.StateOperator.Equals,
              left: {
                kind: RulesV2.OperandKind.SymbolStateRef,
                key: 'flag',
                valueType: StateValueType.Bool,
              },
              right: {
                kind: RulesV2.OperandKind.Literal,
                value: { type: StateValueType.Bool, value: false },
              },
            },
          },
        ],
      },
      actions: [
        {
          kind: RulesV2.ActionKind.SetSymbolState,
          key: 'flag',
          // Wrapper overrides this with alternating Bools so each write is observable.
          value: { type: StateValueType.Bool, value: true },
        },
      ],
    });
    const { orchestrator, eventLog } = await buildOrchestrator({
      rules: [kicker, flipper],
      state: wrapped,
      lookups,
    });
    await orchestrator.process(TICK_EVENT);
    const symbolEvents = await eventLog.symbolEvents('AAPL');
    const overflowEvents = symbolEvents.filter(
      (e) => e.type === RulesV2.RuleEventType.CycleOverflow,
    );
    expect(overflowEvents.length).toEqual(1);
    expect(overflowEvents[0]).toEqual({
      type: RulesV2.RuleEventType.CycleOverflow,
      ts: 1_000,
      firedAt: 9_999,
      ruleId: '',
      symbolId: 'AAPL',
      cycleLimit: 4,
    });
  });
});
