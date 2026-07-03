import {
  ActionKind,
  ComparisonOperator,
  type ConditionNode,
  ConditionNodeKind,
  EvaluationTriggerKind,
  LeafConditionFamily,
  NotificationChannel,
  type Notifier,
  OperandKind,
  Period,
  type Rule,
  RuleEventType,
  type RuleRepository,
  RuleScopeKind,
  StateOperator,
  type StateRepository,
  StateScope,
  type StateValue,
  StateValueType,
  type TickEvent,
  TriggerKind,
  type WatchlistRepository,
} from '@lametrader/core';
import {
  ActionRunner,
  ArraySeriesView,
  barSeriesKey,
  buildEvaluationContext,
  type EvaluationLookups,
  IndicatorSeriesStore,
  InMemoryEventLog,
  InMemoryNotifier,
  InMemoryRuleRepository,
  InMemoryStateRepository,
  InMemoryWatchlistRepository,
  RuleOrchestrator,
  type SeriesView,
  TriggerDispatcher,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';

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
 * a `wireRuleEngine` helper would produce; expressed inline here so the
 * e2e maps 1:1 to the surface the spec describes.
 */
async function wire(opts: {
  rules: Rule[];
  watchlist?: WatchlistRepository;
  notifier?: Notifier & { sent?: Array<{ destinationName: string; body: string }> };
  state?: StateRepository;
  tickPrice?: number;
}): Promise<{
  orchestrator: InstanceType<typeof RuleOrchestrator>;
  notifier: InMemoryNotifier;
  eventLog: InstanceType<typeof InMemoryEventLog>;
  rules: RuleRepository;
}> {
  const repo = new InMemoryRuleRepository();
  for (const r of opts.rules) await repo.save(r);
  const state = opts.state ?? new InMemoryStateRepository();
  const notifier = (opts.notifier ?? new InMemoryNotifier(['main'])) as InMemoryNotifier;
  const watchlist = opts.watchlist ?? new InMemoryWatchlistRepository();
  const eventLog = new InMemoryEventLog(() => 9_999);
  const indicatorStore = new IndicatorSeriesStore();
  const { lookups } = liveLookups(state, { current: opts.tickPrice ?? 120 });
  // Default bar-close series seeded so Price > 100 evaluates true; Price reads
  // the latest close (the platform ingests candles, not trades).
  const barSeries = new Map<string, SeriesView>([
    [
      barSeriesKey(Period.OneMinute, 'close'),
      new ArraySeriesView([
        { ts: 0, value: { type: StateValueType.Number, value: opts.tickPrice ?? 120 } },
      ]),
    ],
  ]);
  const dispatcher = new TriggerDispatcher({
    rules: repo,
    buildContext: (_event, firingSymbolId, profileId) =>
      buildEvaluationContext({
        symbolId: firingSymbolId,
        profileId,
        candleRepository: null as unknown as never,
        barSeries,
        indicatorStore,
        barWindow: { from: 0, to: Number.MAX_SAFE_INTEGER },
        getSymbolState: (pid, symbolId, key) => lookups.getSymbolState(pid, symbolId, key),
        getGlobalState: (pid, key) => lookups.getGlobalState(pid, key),
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

describe('rules orchestrator + action runner (e2e)', () => {
  it('a Tick on a Price > 100 EveryTime rule with a Notification action drives the wired engine: notifier records one send and both event logs end with [NotificationSent, Fired]', async () => {
    const rule: Rule = {
      id: 'r1',
      profileId: 'profile-A',
      name: 'Notify on price up',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: PRICE_GT_100,
      trigger: { kind: TriggerKind.EveryTime },
      expiration: null,
      actions: [
        {
          kind: ActionKind.Notification,
          channel: NotificationChannel.Telegram,
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
    const tick: TickEvent = {
      kind: EvaluationTriggerKind.Tick,
      ts: 1_000,
      symbolId: 'AAPL',
      price: 120,
    };
    await orchestrator.process(tick);
    expect(notifier.sent).toEqual([{ destinationName: 'main', body: 'AAPL hit 120' }]);
    const expectedNotification = {
      type: RuleEventType.NotificationSent,
      ts: 1_000,
      firedAt: 9_999,
      ruleId: 'r1',
      symbolId: 'AAPL',
      destinationName: 'main',
      body: 'AAPL hit 120',
    };
    const expectedFired = {
      type: RuleEventType.Fired,
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

  it('stamps lastFiredAt on the persisted rule with the inbound event ts after a successful fire (issue #426)', async () => {
    const rule: Rule = {
      id: 'r1',
      profileId: 'profile-A',
      name: 'Stamp lastFiredAt',
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
    };
    const { orchestrator, rules } = await wire({ rules: [rule], tickPrice: 120 });
    const tick: TickEvent = {
      kind: EvaluationTriggerKind.Tick,
      ts: 1_000,
      symbolId: 'AAPL',
      price: 120,
    };
    await orchestrator.process(tick);
    expect(await rules.get('r1')).toEqual({ ...rule, lastFiredAt: 1_000 });
  });

  it('a legacy state/Equals(Price, Literal) rule (pre-#429) fires through the rewritten comparison/Eq path on a matching Tick', async () => {
    // Pre-collapse the picker emitted `state/Equals` for any LHS; once #429
    // landed the picker only emits `comparison/Eq` for non-state-ref LHSes
    // and `normalizeRule` rewrites old documents at read time. This e2e
    // confirms the rewrite makes the orchestrator's evaluation engine fire
    // on a literal-equality match (Price == 120) — proving the legacy shape
    // round-trips through dispatch with the post-collapse semantics intact.
    const legacy: Rule = {
      id: 'legacy-equals',
      profileId: 'profile-A',
      name: 'Legacy state/Equals(Price, 120)',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.State,
          operator: StateOperator.Equals,
          left: { kind: OperandKind.Price },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.Number, value: 120 },
          },
        },
      },
      trigger: { kind: TriggerKind.EveryTime },
      expiration: null,
      actions: [
        {
          kind: ActionKind.Notification,
          channel: NotificationChannel.Telegram,
          destinationName: 'main',
          template: 'AAPL equal 120',
        },
      ],
      enabled: true,
      order: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    const { orchestrator, notifier, eventLog, rules } = await wire({
      rules: [legacy],
      tickPrice: 120,
    });
    const tick: TickEvent = {
      kind: EvaluationTriggerKind.Tick,
      ts: 1_000,
      symbolId: 'AAPL',
      price: 120,
    };
    await orchestrator.process(tick);
    expect(notifier.sent).toEqual([{ destinationName: 'main', body: 'AAPL equal 120' }]);
    // The repository's read path rewrites the stored leaf to the collapsed
    // comparison shape — `get` returns the normalised rule.
    const reloaded = await rules.get('legacy-equals');
    expect(reloaded?.condition).toEqual({
      kind: ConditionNodeKind.Leaf,
      leaf: {
        family: LeafConditionFamily.Comparison,
        operator: ComparisonOperator.Eq,
        left: { kind: OperandKind.Price },
        right: {
          kind: OperandKind.Literal,
          value: { type: StateValueType.Number, value: 120 },
        },
      },
    });
    // And the umbrella Fired event reads through to the symbol's log.
    const symbolEvents = await eventLog.symbolEvents('AAPL');
    const firedTypes = symbolEvents.map((e) => e.type);
    expect(firedTypes).toEqual([RuleEventType.NotificationSent, RuleEventType.Fired]);
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
    const kicker: Rule = {
      id: 'kicker',
      profileId: 'profile-A',
      name: 'Kicker',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: PRICE_GT_100,
      trigger: { kind: TriggerKind.EveryTime },
      expiration: null,
      actions: [
        {
          kind: ActionKind.SetSymbolState,
          key: 'flag',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
      enabled: true,
      order: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    const flipper: Rule = {
      id: 'flipper',
      profileId: 'profile-A',
      name: 'Flipper',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
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
      trigger: { kind: TriggerKind.EveryTime },
      expiration: null,
      actions: [
        {
          kind: ActionKind.SetSymbolState,
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
    const tick: TickEvent = {
      kind: EvaluationTriggerKind.Tick,
      ts: 1_000,
      symbolId: 'AAPL',
      price: 120,
    };
    await orchestrator.process(tick);
    const symbolEvents = await eventLog.symbolEvents('AAPL');
    const overflowEntries = symbolEvents.filter((e) => e.type === RuleEventType.CycleOverflow);
    expect(overflowEntries).toEqual([
      {
        type: RuleEventType.CycleOverflow,
        ts: 1_000,
        firedAt: 9_999,
        ruleId: '',
        symbolId: 'AAPL',
        cycleLimit: 4,
      },
    ]);
  });
});
