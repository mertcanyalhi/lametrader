import {
  type Notifier,
  RulesV2,
  type StateRepository,
  StateScope,
  type StateValue,
  StateValueType,
  type WatchlistRepository,
} from '@lametrader/core';
import {
  RulesV2 as EngineRulesV2,
  type EvaluationLookups,
  InMemoryNotifier,
  InMemoryStateRepository,
  InMemoryWatchlistRepository,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';

const {
  ActionRunner,
  buildEvaluationContext,
  IndicatorSeriesStore,
  InMemoryEventLog,
  InMemoryRuleRepository,
  RuleOrchestrator,
  TickRing,
  TriggerDispatcher,
} = EngineRulesV2;

/**
 * Build a sync `EvaluationLookups` that mirrors state writes from the repo
 * and returns a configurable OHLCV snapshot for the firing symbol.
 */
function liveLookups(
  state: StateRepository,
  ohlcv: { current: number },
): {
  lookups: EvaluationLookups;
  mirror: Map<string, StateValue>;
} {
  const mirror = new Map<string, StateValue>();
  state.onStateChanged((event) => {
    const key = `${event.profileId}|${event.scope.kind === StateScope.Symbol ? `S:${event.scope.symbolId}` : 'G'}|${event.key}`;
    if (event.current === null) mirror.delete(key);
    else mirror.set(key, event.current);
  });
  const lookups: EvaluationLookups = {
    getCurrentValue: () => ohlcv.current,
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
  return { lookups, mirror };
}

/**
 * Compose the orchestrator end-to-end on in-memory infra. Equivalent to what
 * a `wireRuleEngineV2` helper would produce; expressed inline here so the
 * e2e maps 1:1 to the surface the spec describes.
 */
async function wire(opts: {
  rules: RulesV2.Rule[];
  watchlist?: WatchlistRepository;
  notifier?: Notifier & { sent?: Array<{ destinationName: string; body: string }> };
  state?: StateRepository;
  tickPrice?: number;
}): Promise<{
  orchestrator: InstanceType<typeof RuleOrchestrator>;
  notifier: InMemoryNotifier;
  eventLog: InstanceType<typeof InMemoryEventLog>;
  rules: RulesV2.RuleRepository;
}> {
  const repo = new InMemoryRuleRepository();
  for (const r of opts.rules) await repo.save(r);
  const state = opts.state ?? new InMemoryStateRepository();
  const notifier = (opts.notifier ?? new InMemoryNotifier(['main'])) as InMemoryNotifier;
  const watchlist = opts.watchlist ?? new InMemoryWatchlistRepository();
  const eventLog = new InMemoryEventLog(() => 9_999);
  const indicatorStore = new IndicatorSeriesStore();
  const { lookups } = liveLookups(state, { current: opts.tickPrice ?? 120 });
  // Default tick rings — one per rule's firing scope, seeded so Price > 100
  // evaluates true.
  const tickRings = new Map<string, InstanceType<typeof TickRing>>();
  for (const r of opts.rules) {
    const ids =
      r.scope.kind === RulesV2.RuleScopeKind.Symbol
        ? [r.scope.symbolId]
        : r.scope.kind === RulesV2.RuleScopeKind.Symbols
          ? r.scope.symbolIds
          : [];
    for (const id of ids) {
      if (tickRings.has(id)) continue;
      const ring = new TickRing();
      ring.push(0, opts.tickPrice ?? 120);
      tickRings.set(id, ring);
    }
  }
  const dispatcher = new TriggerDispatcher({
    rules: repo,
    buildContext: (event, firingSymbolId) =>
      buildEvaluationContext({
        symbolId: firingSymbolId,
        profileId:
          event.kind === RulesV2.EvaluationTriggerKind.SymbolStateChanged ||
          event.kind === RulesV2.EvaluationTriggerKind.GlobalStateChanged
            ? event.profileId
            : 'profile-A',
        candleRepository: null as unknown as never,
        tickRings,
        indicatorStore,
        barWindow: { from: 0, to: Number.MAX_SAFE_INTEGER },
        getSymbolState: (profileId, symbolId, key) =>
          lookups.getSymbolState(profileId, symbolId, key),
        getGlobalState: (profileId, key) => lookups.getGlobalState(profileId, key),
      }),
  });
  const actions = new ActionRunner(state, notifier, lookups);
  const orchestrator = new RuleOrchestrator({
    rules: repo,
    state,
    watchlist,
    dispatcher,
    actions,
    eventLog,
  });
  return { orchestrator, notifier, eventLog, rules: repo };
}

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

describe('rules-v2 orchestrator + action runner (e2e)', () => {
  it('a Tick on a Price > 100 EveryTime rule with a Notification action drives the wired engine: notifier records one send and both event logs end with [NotificationSent, Fired]', async () => {
    const rule: RulesV2.Rule = {
      id: 'r1',
      profileId: 'profile-A',
      name: 'Notify on price up',
      scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: PRICE_GT_100,
      trigger: { kind: RulesV2.TriggerKind.EveryTime },
      expiration: null,
      actions: [
        {
          kind: RulesV2.ActionKind.Notification,
          channel: RulesV2.NotificationChannel.Telegram,
          destinationName: 'main',
          template: 'AAPL hit {current}',
        },
      ],
      enabled: true,
      order: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    const { orchestrator, notifier, eventLog } = await wire({ rules: [rule], tickPrice: 120 });
    const tick: RulesV2.TickEvent = {
      kind: RulesV2.EvaluationTriggerKind.Tick,
      ts: 1_000,
      symbolId: 'AAPL',
      price: 120,
    };
    await orchestrator.process(tick);
    expect(notifier.sent).toEqual([{ destinationName: 'main', body: 'AAPL hit 120' }]);
    const expectedNotification = {
      type: RulesV2.RuleEventType.NotificationSent,
      ts: 1_000,
      firedAt: 9_999,
      ruleId: 'r1',
      symbolId: 'AAPL',
      destinationName: 'main',
      body: 'AAPL hit 120',
    };
    const expectedFired = {
      type: RulesV2.RuleEventType.Fired,
      ts: 1_000,
      firedAt: 9_999,
      ruleId: 'r1',
      symbolId: 'AAPL',
      context: {
        inboundEvent: tick,
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
    expect(await eventLog.symbolEvents('AAPL')).toEqual([expectedNotification, expectedFired]);
    expect(await eventLog.ruleEvents('r1')).toEqual([expectedNotification, expectedFired]);
  });

  it('critical failure mode — a cascade of state writes that exceeds the cycle limit records exactly one CycleOverflow entry on the symbol log and halts further cascade', async () => {
    // A `kicker` fires on the Tick and sets a state key; a `flipper`'s
    // condition references the same key and its action writes alternating
    // bool values back. The ping-pong runs until the cycle guard halts it
    // and records exactly one CycleOverflow entry on the affected symbol.
    const state = new InMemoryStateRepository();
    let next = false;
    const wrappedState: StateRepository = {
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
        const v: StateValue = { type: StateValueType.Bool, value: next };
        next = !next;
        return state.setSymbolState(profileId, symbolId, key, v, ts);
      },
    };
    const kicker: RulesV2.Rule = {
      id: 'kicker',
      profileId: 'profile-A',
      name: 'Kicker',
      scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: PRICE_GT_100,
      trigger: { kind: RulesV2.TriggerKind.EveryTime },
      expiration: null,
      actions: [
        {
          kind: RulesV2.ActionKind.SetSymbolState,
          key: 'flag',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
      enabled: true,
      order: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    const flipper: RulesV2.Rule = {
      id: 'flipper',
      profileId: 'profile-A',
      name: 'Flipper',
      scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'AAPL' },
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
      trigger: { kind: RulesV2.TriggerKind.EveryTime },
      expiration: null,
      actions: [
        {
          kind: RulesV2.ActionKind.SetSymbolState,
          key: 'flag',
          // Overridden by wrappedState to alternate Bool values per call.
          value: { type: StateValueType.Bool, value: true },
        },
      ],
      enabled: true,
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    };
    const { orchestrator, eventLog } = await wire({
      rules: [kicker, flipper],
      state: wrappedState,
    });
    const tick: RulesV2.TickEvent = {
      kind: RulesV2.EvaluationTriggerKind.Tick,
      ts: 1_000,
      symbolId: 'AAPL',
      price: 120,
    };
    await orchestrator.process(tick);
    const symbolEvents = await eventLog.symbolEvents('AAPL');
    const overflowEntries = symbolEvents.filter(
      (e) => e.type === RulesV2.RuleEventType.CycleOverflow,
    );
    expect(overflowEntries).toEqual([
      {
        type: RulesV2.RuleEventType.CycleOverflow,
        ts: 1_000,
        firedAt: 9_999,
        ruleId: '',
        symbolId: 'AAPL',
        cycleLimit: 4,
      },
    ]);
  });
});
