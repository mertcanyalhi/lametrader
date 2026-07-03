import {
  ActionKind,
  ComparisonOperator,
  type ConditionNode,
  ConditionNodeKind,
  EvaluationTriggerKind,
  LeafConditionFamily,
  NotificationChannel,
  OperandKind,
  Period,
  type Rule,
  type RuleEvent,
  RuleEventType,
  type RuleRepository,
  RuleScopeKind,
  StateOperator,
  type StateRepository,
  StateScope,
  StateValueType,
  SymbolType,
  type TickEvent,
  type TimerEvent,
  TriggerKind,
  type WatchlistRepository,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { InMemoryNotifier } from '../../notification/in-memory-notifier.js';
import { InMemoryStateRepository } from '../../state/in-memory-state-repository.js';
import { InMemoryWatchlistRepository } from '../../symbols/in-memory-watchlist-repository.js';
import { TriggerDispatcher } from '../dispatch/dispatcher.js';
import { InMemoryRuleRepository } from '../dispatch/in-memory-rule-repository.js';
import { barSeriesKey, buildEvaluationContext } from '../evaluation-context.js';
import type { EvaluationContext } from '../evaluation-context.types.js';
import { ArraySeriesView, IndicatorSeriesStore } from '../indicator-series-store.js';
import type { SeriesView } from '../series.types.js';
import type { EvaluationLookups } from '../wire/live-evaluation-lookups.types.js';

/** A bar-close series carrying a single snapshot value — backs the `Price` operand. */
function closeSeriesAt(close: number): Map<string, SeriesView> {
  return new Map([
    [
      barSeriesKey(Period.OneMinute, 'close'),
      new ArraySeriesView([{ ts: 0, value: { type: StateValueType.Number, value: close } }]),
    ],
  ]);
}

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
const PRICE_GT_100: ConditionNode = {
  kind: ConditionNodeKind.Leaf,
  leaf: {
    family: LeafConditionFamily.Comparison,
    operator: ComparisonOperator.Gt,
    left: { kind: OperandKind.Price },
    right: {
      kind: OperandKind.Literal,
      value: { type: StateValueType.Number, value: 100 },
    },
  },
};

/** Build a Rule with sensible defaults the tests override field-by-field. */
function ruleWith(overrides: Partial<Rule> & Pick<Rule, 'id'>): Rule {
  return {
    profileId: PROFILE_A,
    name: 'Test',
    scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
    condition: PRICE_GT_100,
    trigger: { kind: TriggerKind.EveryTime },
    expiration: null,
    actions: [
      {
        kind: ActionKind.Notification,
        channel: NotificationChannel.Telegram,
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
  rules: Rule[];
  notifier?: InMemoryNotifier;
  state?: StateRepository;
  watchlist?: WatchlistRepository;
  lookups?: EvaluationLookups;
  barSeries?: ReadonlyMap<string, SeriesView>;
  now?: () => number;
  rulesRepo?: RuleRepository;
}): Promise<{
  orchestrator: RuleOrchestrator;
  notifier: InMemoryNotifier;
  state: StateRepository;
  rules: RuleRepository;
  eventLog: InMemoryEventLog;
  watchlist: WatchlistRepository;
}> {
  const repo = opts.rulesRepo ?? new InMemoryRuleRepository();
  for (const r of opts.rules) await repo.save(r);
  const state = opts.state ?? new InMemoryStateRepository();
  const notifier = opts.notifier ?? new InMemoryNotifier(['main']);
  const lookups = opts.lookups ?? fixedLookups(120);
  const watchlist = opts.watchlist ?? new InMemoryWatchlistRepository();
  const eventLog = new InMemoryEventLog(opts.now ?? (() => 9_999));
  // Default bar-close series at 120 so a Price > 100 condition evaluates true.
  // Tests that need a specific price override `barSeries` directly.
  const barSeries = opts.barSeries ?? closeSeriesAt(120);
  const indicatorStore = new IndicatorSeriesStore();
  const buildContext = (
    _event: RuleEvent,
    firingSymbolId: string,
    profileId: string,
  ): EvaluationContext =>
    buildEvaluationContext({
      symbolId: firingSymbolId,
      profileId,
      candleRepository: null as unknown as never,
      barSeries,
      indicatorStore,
      barWindow: { from: 0, to: Number.MAX_SAFE_INTEGER },
      getSymbolState: (pid, symbolId, key) => lookups.getSymbolState(pid, symbolId, key),
      getGlobalState: (pid, key) => lookups.getGlobalState(pid, key),
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

const TICK_AT = (ts: number, symbolId = 'AAPL'): TickEvent => ({
  kind: EvaluationTriggerKind.Tick,
  ts,
  symbolId,
  price: 120,
});

const TICK_EVENT = TICK_AT(1_000);

/**
 * Wraps a real {@link RuleRepository}, recording every
 * `listEnabledForSymbol` call so the orchestrator's per-tick query count is
 * observable.
 */
class CountingRuleRepository implements RuleRepository {
  readonly listEnabledCalls: Array<{ symbolId: string | null; profileId: string | undefined }> = [];

  constructor(private readonly delegate: RuleRepository) {}

  async listEnabledForSymbol(symbolId: string | null, profileId?: string): Promise<Rule[]> {
    this.listEnabledCalls.push({ symbolId, profileId });
    return this.delegate.listEnabledForSymbol(symbolId, profileId);
  }

  list(): Promise<Rule[]> {
    return this.delegate.list();
  }
  listForSymbol(symbolId: string | null, profileId?: string): Promise<Rule[]> {
    return this.delegate.listForSymbol(symbolId, profileId);
  }
  get(id: string): Promise<Rule | null> {
    return this.delegate.get(id);
  }
  claimOnceFire(ruleId: string): Promise<boolean> {
    return this.delegate.claimOnceFire(ruleId);
  }
  save(rule: Rule): Promise<void> {
    return this.delegate.save(rule);
  }
  remove(id: string): Promise<void> {
    return this.delegate.remove(id);
  }
  removeForProfile(profileId: string): Promise<string[]> {
    return this.delegate.removeForProfile(profileId);
  }
}

describe('RuleOrchestrator', () => {
  it('issues at most one listEnabledForSymbol query per distinct (symbolId, profileId) pair across a tick and its cascades', async () => {
    const counting = new CountingRuleRepository(new InMemoryRuleRepository());
    const rule = ruleWith({
      id: 'r1',
      profileId: PROFILE_A,
      actions: [
        {
          kind: ActionKind.SetSymbolState,
          key: 'k1',
          value: { type: StateValueType.Number, value: 1 },
        },
        {
          kind: ActionKind.SetSymbolState,
          key: 'k2',
          value: { type: StateValueType.Number, value: 2 },
        },
      ],
    });
    const { orchestrator } = await buildOrchestrator({ rules: [rule], rulesRepo: counting });
    await orchestrator.process(TICK_EVENT);
    expect(counting.listEnabledCalls).toEqual([
      { symbolId: 'AAPL', profileId: undefined },
      { symbolId: 'AAPL', profileId: PROFILE_A },
    ]);
  });

  it('a Tick on an EveryTime Price > 100 rule fires once and appends [NotificationSent, Fired] to both the rule log and the symbol log', async () => {
    const { orchestrator, notifier, eventLog } = await buildOrchestrator({
      rules: [ruleWith({ id: 'r1' })],
    });
    await orchestrator.process(TICK_EVENT);
    const symbolEvents = await eventLog.symbolEvents('AAPL');
    const ruleEvents = await eventLog.ruleEvents('r1');
    const expectedNotification = {
      type: RuleEventType.NotificationSent,
      ts: 1_000,
      firedAt: 9_999,
      ruleId: 'r1',
      symbolId: 'AAPL',
      destinationName: 'main',
      body: 'fired',
    };
    const expectedFired = {
      type: RuleEventType.Fired,
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

  it('Once trigger: after the first fire the rule is saved back to the repository with enabled: false and lastFiredAt set to the tick ts', async () => {
    const { orchestrator, rules } = await buildOrchestrator({
      rules: [ruleWith({ id: 'r1', trigger: { kind: TriggerKind.Once } })],
    });
    await orchestrator.process(TICK_EVENT);
    const persisted = await rules.get('r1');
    expect(persisted).toEqual({
      ...ruleWith({ id: 'r1', trigger: { kind: TriggerKind.Once } }),
      enabled: false,
      lastFiredAt: 1_000,
    });
  });

  it('OncePerBar trigger: a burst of three ticks within the same bar fires the rule exactly once', async () => {
    const { orchestrator, notifier } = await buildOrchestrator({
      rules: [
        ruleWith({
          id: 'r1',
          trigger: { kind: TriggerKind.OncePerBar, period: Period.OneMinute },
        }),
      ],
    });
    await orchestrator.process(TICK_AT(1_000));
    await orchestrator.process(TICK_AT(2_000));
    await orchestrator.process(TICK_AT(3_000));
    expect(notifier.sent).toEqual([{ destinationName: 'main', body: 'fired' }]);
  });

  it('state-mutation action cascades into a downstream rule whose condition reads the mutated state key, within the same process() call', async () => {
    const downstream: Rule = ruleWith({
      id: 'downstream',
      order: 1,
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.State,
          operator: StateOperator.Equals,
          left: {
            kind: OperandKind.SymbolStateRef,
            key: 'armed',
            valueType: StateValueType.Bool,
          },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.Bool, value: true },
          },
        },
      },
      actions: [
        {
          kind: ActionKind.Notification,
          channel: NotificationChannel.Telegram,
          destinationName: 'main',
          template: 'downstream-fired',
        },
      ],
    });
    const upstream: Rule = ruleWith({
      id: 'upstream',
      order: 0,
      actions: [
        {
          kind: ActionKind.SetSymbolState,
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
          kind: ActionKind.Notification,
          channel: NotificationChannel.Telegram,
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
          kind: ActionKind.Notification,
          channel: NotificationChannel.Telegram,
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
      RuleEventType.NotificationSent,
      RuleEventType.Fired,
    ]);
    expect(bEvents.map((e) => e.type)).toEqual([
      RuleEventType.NotificationSent,
      RuleEventType.Fired,
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
    const { orchestrator, eventLog } = await buildOrchestrator({
      rules: [
        ruleWith({
          id: 'all',
          scope: { kind: RuleScopeKind.AllSymbols },
          trigger: { kind: TriggerKind.OncePerInterval, intervalMs: 60_000 },
        }),
      ],
      watchlist,
      barSeries: closeSeriesAt(120),
    });
    const timer: TimerEvent = {
      kind: EvaluationTriggerKind.Timer,
      ts: 1_000,
    };
    await orchestrator.process(timer);
    const aaplFires = (await eventLog.symbolEvents('AAPL')).filter(
      (e) => e.type === RuleEventType.Fired,
    );
    const msftFires = (await eventLog.symbolEvents('MSFT')).filter(
      (e) => e.type === RuleEventType.Fired,
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
    const { orchestrator, eventLog } = await buildOrchestrator({
      rules: [
        ruleWith({
          id: 'multi',
          scope: { kind: RuleScopeKind.Symbols, symbolIds: ['AAPL', 'MSFT'] },
          trigger: { kind: TriggerKind.OncePerInterval, intervalMs: 60_000 },
        }),
      ],
      watchlist,
      barSeries: closeSeriesAt(120),
    });
    const timer: TimerEvent = {
      kind: EvaluationTriggerKind.Timer,
      ts: 1_000,
    };
    await orchestrator.process(timer);
    const aaplFires = (await eventLog.symbolEvents('AAPL')).filter(
      (e) => e.type === RuleEventType.Fired,
    );
    const msftFires = (await eventLog.symbolEvents('MSFT')).filter(
      (e) => e.type === RuleEventType.Fired,
    );
    const googFires = (await eventLog.symbolEvents('GOOG')).filter(
      (e) => e.type === RuleEventType.Fired,
    );
    expect(aaplFires.length).toEqual(1);
    expect(msftFires.length).toEqual(1);
    expect(googFires.length).toEqual(0);
  });

  it('stamps lastFiredAt on the persisted rule with the inbound event ts after a fire', async () => {
    const { orchestrator, rules } = await buildOrchestrator({
      rules: [ruleWith({ id: 'r1' })],
    });
    await orchestrator.process(TICK_EVENT);
    const persisted = await rules.get('r1');
    expect(persisted).toEqual({
      ...ruleWith({ id: 'r1' }),
      lastFiredAt: 1_000,
    });
  });

  it('leaves lastFiredAt untouched when no rule fires (condition unmet)', async () => {
    // Seed the close below the rule's `Price > 100` threshold so the
    // condition evaluates false; the orchestrator must NOT stamp lastFiredAt.
    const { orchestrator, rules } = await buildOrchestrator({
      rules: [ruleWith({ id: 'r1' })],
      barSeries: closeSeriesAt(50),
    });
    await orchestrator.process(TICK_EVENT);
    const persisted = await rules.get('r1');
    expect(persisted).toEqual(ruleWith({ id: 'r1' }));
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
    const kicker: Rule = ruleWith({
      id: 'kicker',
      order: 0,
      actions: [
        {
          kind: ActionKind.SetSymbolState,
          key: 'flag',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
    });
    // The flipper's condition covers BOTH true and false so the cascade
    // always re-fires regardless of which value the wrapper wrote.
    const flipper: Rule = ruleWith({
      id: 'flipper',
      order: 1,
      condition: {
        kind: ConditionNodeKind.Or,
        children: [
          {
            kind: ConditionNodeKind.Leaf,
            leaf: {
              family: LeafConditionFamily.State,
              operator: StateOperator.Equals,
              left: {
                kind: OperandKind.SymbolStateRef,
                key: 'flag',
                valueType: StateValueType.Bool,
              },
              right: {
                kind: OperandKind.Literal,
                value: { type: StateValueType.Bool, value: true },
              },
            },
          },
          {
            kind: ConditionNodeKind.Leaf,
            leaf: {
              family: LeafConditionFamily.State,
              operator: StateOperator.Equals,
              left: {
                kind: OperandKind.SymbolStateRef,
                key: 'flag',
                valueType: StateValueType.Bool,
              },
              right: {
                kind: OperandKind.Literal,
                value: { type: StateValueType.Bool, value: false },
              },
            },
          },
        ],
      },
      actions: [
        {
          kind: ActionKind.SetSymbolState,
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
    const overflowEvents = symbolEvents.filter((e) => e.type === RuleEventType.CycleOverflow);
    expect(overflowEvents.length).toEqual(1);
    expect(overflowEvents[0]).toEqual({
      type: RuleEventType.CycleOverflow,
      ts: 1_000,
      firedAt: 9_999,
      ruleId: '',
      symbolId: 'AAPL',
      cycleLimit: 4,
    });
  });
});
