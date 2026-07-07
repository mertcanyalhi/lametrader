import {
  ActionKind,
  ComparisonOperator,
  ConditionNodeKind,
  EvaluationTriggerKind,
  LeafConditionFamily,
  MovingOperator,
  NotificationChannel,
  OperandKind,
  Period,
  type Rule,
  RuleEventType,
  RuleScopeKind,
  StateOperator,
  StateScope,
  StateValueType,
  SymbolType,
  type Trigger,
  TriggerKind,
} from '@lametrader/core';
import { InMemoryEventLog } from '../../../common/persistence/in-memory-event-log.js';
import { InMemoryNotifier } from '../../../common/services/in-memory-notifier.js';
import { InMemoryCandleRepository } from '../../../market/persistence/in-memory-candle.repository.js';
import { InMemoryWatchlistRepository } from '../../../market/persistence/in-memory-watchlist.repository.js';
import { IndicatorService } from '../../indicators/indicator.service.js';
import { IndicatorRegistry } from '../../indicators/indicator-registry.js';
import { movingAverage } from '../../indicators/sma.js';
import { InMemoryStateRepository } from '../../persistence/in-memory-state.repository.js';
import { InMemoryOncePerBarLatchStore } from '../dispatch/in-memory-once-per-bar-latch.store.js';
import { _resetLogRoot, _setLogLevel } from '../engine-log.js';
import { InMemoryRuleRepository } from '../in-memory-rule.repository.js';
import { IndicatorSeriesStore } from '../indicator-series-store.js';
import { wireRuleEngine } from './wire-rule-engine.js';

/** Registered SMA instance id every #548 memo test references. */
const SMA_INSTANCE_ID = 'sma-3-inst';
/** The SMA inputs — one shared operand identity across every fanned event. */
const SMA_INPUTS = { length: 3, source: 'close' } as const;

describe('wireRuleEngine', () => {
  let rules: InMemoryRuleRepository;
  let eventLog: InMemoryEventLog;
  let state: InMemoryStateRepository;
  let watchlist: InMemoryWatchlistRepository;
  let notifier: InMemoryNotifier;
  let candles: InMemoryCandleRepository;
  let indicatorStore: IndicatorSeriesStore;

  beforeEach(async () => {
    rules = new InMemoryRuleRepository();
    eventLog = new InMemoryEventLog(() => 0);
    state = new InMemoryStateRepository();
    watchlist = new InMemoryWatchlistRepository();
    await watchlist.add({ id: 'AAPL', periods: [Period.OneMinute] });
    notifier = new InMemoryNotifier();
    candles = new InMemoryCandleRepository();
    indicatorStore = new IndicatorSeriesStore();
  });

  it('drives a tick-cadence Price > 100 rule end-to-end and writes Fired + StateSet to both event logs', async () => {
    const ruleId = 'r1';
    await rules.save({
      id: ruleId,
      profileId: 'profile-1',
      name: 'price > 100',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
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
      },
      trigger: { kind: TriggerKind.EveryTime },
      expiration: null,
      actions: [
        {
          kind: ActionKind.SetSymbolState,
          key: 'breached',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
      enabled: true,
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    });

    const wired = await wireRuleEngine({
      rules,
      oncePerBarLatch: new InMemoryOncePerBarLatchStore(),
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository: candles,
      indicatorStore,
    });

    wired.barBridge.handleCandle({
      id: 'AAPL',
      period: Period.OneMinute,
      candle: { time: 60_000, open: 101, high: 101, low: 101, close: 101, volume: 10 },
      final: false,
    });
    await wired.drain();

    const ruleEvents = await eventLog.ruleEvents(ruleId);
    expect(ruleEvents.map((e) => e.type)).toEqual([RuleEventType.StateSet, RuleEventType.Fired]);
    const symbolEvents = await eventLog.symbolEvents('AAPL');
    expect(symbolEvents.map((e) => e.type)).toEqual([RuleEventType.StateSet, RuleEventType.Fired]);
    expect(await state.getSymbolState('profile-1', 'AAPL', 'breached')).toEqual({
      type: StateValueType.Bool,
      value: true,
    });
  });

  it('logs the error and appends an Error rule-event entry on the symbol log when the orchestrator throws (regression #431)', async () => {
    const captured: string[] = [];
    const sink = {
      write(line: string): void {
        captured.push(line);
      },
    };
    _resetLogRoot(sink);
    _setLogLevel('error');
    try {
      const corruptRules: typeof rules = Object.create(rules);
      corruptRules.listEnabledForSymbol = () => {
        throw new Error('repository timeout');
      };
      const wired = await wireRuleEngine({
        rules: corruptRules,
        oncePerBarLatch: new InMemoryOncePerBarLatchStore(),
        state,
        watchlist,
        eventLog,
        notifier,
        candleRepository: candles,
        indicatorStore,
      });

      wired.barBridge.handleCandle({
        id: 'AAPL',
        period: Period.OneMinute,
        candle: { time: 60_000, open: 101, high: 101, low: 101, close: 101, volume: 10 },
        final: false,
      });
      await wired.drain();

      // The candle fans out to a BarOpened and a Tick; the corrupt repository
      // throws on each, so one Error entry is appended per event.
      const symbolEvents = await eventLog.symbolEvents('AAPL');
      expect(symbolEvents).toEqual([
        {
          type: RuleEventType.Error,
          ts: 60_000,
          firedAt: 0,
          ruleId: '',
          symbolId: 'AAPL',
          reason: 'orchestrator process failed: repository timeout',
        },
        {
          type: RuleEventType.Error,
          ts: 60_000,
          firedAt: 0,
          ruleId: '',
          symbolId: 'AAPL',
          reason: 'orchestrator process failed: repository timeout',
        },
      ]);
      const logged = captured.map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(
        logged.some(
          (entry) =>
            entry.scope === 'engine.rules.wire' &&
            entry.level === 50 &&
            entry.msg === 'orchestrator_process_failed' &&
            entry.symbolId === 'AAPL' &&
            typeof entry.err === 'object' &&
            entry.err !== null &&
            (entry.err as { message?: unknown }).message === 'repository timeout',
        ),
      ).toEqual(true);
    } finally {
      _resetLogRoot();
      _setLogLevel('info');
    }
  });

  it('fires a tick-cadence rule whose condition references SymbolStateRef when the state was set under the rule profile (regression #431)', async () => {
    const ruleId = 'r-state';
    const stateAwareRule: Rule = {
      id: ruleId,
      profileId: 'profile-1',
      name: 'state-aware',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.State,
          operator: StateOperator.Equals,
          left: {
            kind: OperandKind.SymbolStateRef,
            key: 'breached',
            valueType: StateValueType.Bool,
          },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.Bool, value: true },
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
          template: 'state hit',
        },
      ],
      enabled: true,
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    };
    await rules.save(stateAwareRule);

    const allowingNotifier = new InMemoryNotifier(['main']);
    const wired = await wireRuleEngine({
      rules,
      oncePerBarLatch: new InMemoryOncePerBarLatchStore(),
      state,
      watchlist,
      eventLog,
      notifier: allowingNotifier,
      candleRepository: candles,
      indicatorStore,
    });
    // Set state under the rule's profile AFTER wiring so the sync lookups
    // mirror (subscribed in `wireRuleEngine`) sees the write — same
    // ordering the production engine uses (`warmInitialState` covers the
    // cold-start path, not exercised by this regression test).
    await state.setSymbolState(
      'profile-1',
      'AAPL',
      'breached',
      { type: StateValueType.Bool, value: true },
      0,
    );

    wired.barBridge.handleCandle({
      id: 'AAPL',
      period: Period.OneMinute,
      candle: { time: 60_000, open: 101, high: 101, low: 101, close: 101, volume: 10 },
      final: false,
    });
    await wired.drain();

    const ruleEvents = await eventLog.ruleEvents(ruleId);
    expect(ruleEvents.map((e) => e.type)).toEqual([
      RuleEventType.NotificationSent,
      RuleEventType.Fired,
    ]);
    expect(allowingNotifier.sent).toEqual([{ destinationName: 'main', body: 'state hit' }]);
  });

  it('exposes the bar bridge so a BarClosed event triggers OncePerBarClose rules', async () => {
    const ruleId = 'r2';
    await rules.save({
      id: ruleId,
      profileId: 'profile-1',
      name: 'bar close > 100',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.Comparison,
          operator: ComparisonOperator.Gt,
          left: { kind: OperandKind.Close },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.Number, value: 100 },
          },
          interval: Period.OneMinute,
        },
      },
      trigger: { kind: TriggerKind.OncePerBarClose, period: Period.OneMinute },
      expiration: null,
      actions: [
        {
          kind: ActionKind.SetSymbolState,
          key: 'bar-fired',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
      enabled: true,
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    });

    await candles.save('AAPL', Period.OneMinute, [
      { time: 60_000, open: 99, high: 102, low: 99, close: 101, volume: 10 },
    ]);

    const wired = await wireRuleEngine({
      rules,
      oncePerBarLatch: new InMemoryOncePerBarLatchStore(),
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository: candles,
      indicatorStore,
    });

    wired.barBridge.handleCandle({
      id: 'AAPL',
      period: Period.OneMinute,
      candle: { time: 60_000, open: 99, high: 102, low: 99, close: 101, volume: 10 },
      final: true,
    });
    await wired.drain();

    const ruleEvents = await eventLog.ruleEvents(ruleId);
    expect(ruleEvents.map((e) => e.type)).toEqual([RuleEventType.StateSet, RuleEventType.Fired]);
    expect(await state.getSymbolState('profile-1', 'AAPL', 'bar-fired')).toEqual({
      type: StateValueType.Bool,
      value: true,
    });
  });

  it('warms the sync lookups mirror with persisted symbol-state on wire-up so the seeded value is visible before any StateChangedEvent fires (regression #432)', async () => {
    await state.setSymbolState(
      'profile-1',
      'AAPL',
      'breached',
      { type: StateValueType.Bool, value: true },
      0,
    );
    await rules.save({
      id: 'r-warm',
      profileId: 'profile-1',
      name: 'warm-up',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.State,
          operator: StateOperator.Equals,
          left: {
            kind: OperandKind.SymbolStateRef,
            key: 'breached',
            valueType: StateValueType.Bool,
          },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.Bool, value: true },
          },
        },
      },
      trigger: { kind: TriggerKind.EveryTime },
      expiration: null,
      actions: [
        {
          kind: ActionKind.SetSymbolState,
          key: 'noop',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
      enabled: true,
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    });

    const wired = await wireRuleEngine({
      rules,
      oncePerBarLatch: new InMemoryOncePerBarLatchStore(),
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository: candles,
      indicatorStore,
    });

    expect(wired.lookups.getSymbolState('profile-1', 'AAPL', 'breached')).toEqual({
      type: StateValueType.Bool,
      value: true,
    });
  });

  it('warms persisted symbol-state for every (profileId, watchedSymbolId) pair so a seeded value on a symbol no rule directly references is still visible (regression #432)', async () => {
    // Profile is discovered via the rule repository even though the rule's
    // own scope is a different symbol; MSFT is on the watchlist (added in
    // beforeEach via the helper extension below).
    await watchlist.add({ id: 'MSFT', periods: [Period.OneMinute] });
    await state.setSymbolState(
      'profile-1',
      'MSFT',
      'armed',
      { type: StateValueType.Number, value: 7 },
      0,
    );
    await rules.save({
      id: 'r-other',
      profileId: 'profile-1',
      name: 'unrelated',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.Comparison,
          operator: ComparisonOperator.Gt,
          left: { kind: OperandKind.Price },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.Number, value: 0 },
          },
        },
      },
      trigger: { kind: TriggerKind.EveryTime },
      expiration: null,
      actions: [],
      enabled: true,
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    });

    const wired = await wireRuleEngine({
      rules,
      oncePerBarLatch: new InMemoryOncePerBarLatchStore(),
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository: candles,
      indicatorStore,
    });

    expect(wired.lookups.getSymbolState('profile-1', 'MSFT', 'armed')).toEqual({
      type: StateValueType.Number,
      value: 7,
    });
  });

  it('warms persisted global-state for every profileId discovered from rules.list() (regression #432)', async () => {
    await state.setGlobalState('profile-1', 'regime', { type: StateValueType.Number, value: 3 }, 0);
    await rules.save({
      id: 'r-any',
      profileId: 'profile-1',
      name: 'any',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.Comparison,
          operator: ComparisonOperator.Gt,
          left: { kind: OperandKind.Price },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.Number, value: 0 },
          },
        },
      },
      trigger: { kind: TriggerKind.EveryTime },
      expiration: null,
      actions: [],
      enabled: true,
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    });

    const wired = await wireRuleEngine({
      rules,
      oncePerBarLatch: new InMemoryOncePerBarLatchStore(),
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository: candles,
      indicatorStore,
    });

    expect(wired.lookups.getGlobalState('profile-1', 'regime')).toEqual({
      type: StateValueType.Number,
      value: 3,
    });
  });

  it('records each candle in-step so a bar-close rule fires only for the bar whose values satisfy it when a rollover batch of two final bars is fed without draining between them (regression #459)', async () => {
    // A catch-up poll returns two already-closed bars back-to-back; the bridge
    // fans them out synchronously and the serializer processes them after.
    // Bar A's close (99) fails `Close > 100`; bar B's close (105) passes.
    // Before #459 the sync `recordCandle` ran ahead of the queue, so the mirror
    // already held bar B's close when bar A's `BarClosed` was evaluated —
    // firing (mis-attributed) for bar A AND again for bar B.
    const ruleId = 'r-close';
    await rules.save({
      id: ruleId,
      profileId: 'profile-1',
      name: 'close > 100 once per bar close',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.Comparison,
          operator: ComparisonOperator.Gt,
          left: { kind: OperandKind.Close },
          right: {
            kind: OperandKind.Literal,
            value: { type: StateValueType.Number, value: 100 },
          },
          interval: Period.OneMinute,
        },
      },
      trigger: { kind: TriggerKind.OncePerBarClose, period: Period.OneMinute },
      expiration: null,
      actions: [
        {
          kind: ActionKind.SetSymbolState,
          key: 'fired',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
      enabled: true,
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    });

    const wired = await wireRuleEngine({
      rules,
      oncePerBarLatch: new InMemoryOncePerBarLatchStore(),
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository: candles,
      indicatorStore,
    });

    wired.barBridge.handleCandle({
      id: 'AAPL',
      period: Period.OneMinute,
      candle: { time: 60_000, open: 98, high: 100, low: 97, close: 99, volume: 10 },
      final: true,
    });
    wired.barBridge.handleCandle({
      id: 'AAPL',
      period: Period.OneMinute,
      candle: { time: 120_000, open: 104, high: 107, low: 103, close: 105, volume: 20 },
      final: true,
    });
    await wired.drain();

    expect(await eventLog.symbolEvents('AAPL')).toEqual([
      {
        type: RuleEventType.StateSet,
        ts: 120_000,
        firedAt: 0,
        ruleId,
        symbolId: 'AAPL',
        scope: StateScope.Symbol,
        key: 'fired',
        value: { type: StateValueType.Bool, value: true },
      },
      {
        type: RuleEventType.Fired,
        ts: 120_000,
        firedAt: 0,
        ruleId,
        symbolId: 'AAPL',
        context: {
          inboundEvent: {
            kind: EvaluationTriggerKind.BarClosed,
            ts: 120_000,
            symbolId: 'AAPL',
            period: Period.OneMinute,
          },
          lookupSnapshot: {
            period: Period.OneMinute,
            current: 105,
            open: 104,
            high: 107,
            low: 103,
            close: 105,
            volume: 20,
          },
        },
      },
    ]);
  });

  it('records each tick in-step so a failing earlier tick does not read a later tick price fed in the same synchronous batch (regression #459)', async () => {
    // Two ticks for one symbol arrive back-to-back with no drain between them.
    // The first (50) fails `Price > 100`; the second (150) passes. Before #459
    // the tick ring + quote mirror were pushed ahead of the queue, so the first
    // tick read the second tick's price and fired (mis-attributed at ts 1_000).
    const ruleId = 'r-price';
    await rules.save({
      id: ruleId,
      profileId: 'profile-1',
      name: 'price > 100 every time',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
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
      },
      trigger: { kind: TriggerKind.EveryTime },
      expiration: null,
      actions: [
        {
          kind: ActionKind.SetSymbolState,
          key: 'hit',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
      enabled: true,
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    });

    const wired = await wireRuleEngine({
      rules,
      oncePerBarLatch: new InMemoryOncePerBarLatchStore(),
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository: candles,
      indicatorStore,
    });

    wired.barBridge.handleCandle({
      id: 'AAPL',
      period: Period.OneMinute,
      candle: { time: 1_000, open: 50, high: 50, low: 50, close: 50, volume: 5 },
      final: false,
    });
    wired.barBridge.handleCandle({
      id: 'AAPL',
      period: Period.OneMinute,
      candle: { time: 2_000, open: 150, high: 150, low: 150, close: 150, volume: 10 },
      final: false,
    });
    await wired.drain();

    expect(await eventLog.symbolEvents('AAPL')).toEqual([
      {
        type: RuleEventType.StateSet,
        ts: 2_000,
        firedAt: 0,
        ruleId,
        symbolId: 'AAPL',
        scope: StateScope.Symbol,
        key: 'hit',
        value: { type: StateValueType.Bool, value: true },
      },
      {
        type: RuleEventType.Fired,
        ts: 2_000,
        firedAt: 0,
        ruleId,
        symbolId: 'AAPL',
        context: {
          inboundEvent: {
            kind: EvaluationTriggerKind.Tick,
            ts: 2_000,
            symbolId: 'AAPL',
            price: 150,
          },
          lookupSnapshot: {
            current: 150,
            open: null,
            high: null,
            low: null,
            close: null,
            volume: null,
          },
        },
      },
    ]);
  });

  it('fires a MovingUp rule end-to-end because the live bar series is the real multi-bar candle history, not a single point (regression #499)', async () => {
    // Two 1m bars live in the candle store: close 100 then close 110. A
    // MovingUp(lookbackBars: 1, threshold: 5) leaf needs the prior bar to
    // compute the delta (110 - 100 = 10 >= 5). Before #499 the live context
    // saw a single-point bar series, so `evaluateMoving` short-circuited at
    // its `length < lookbackBars + 1` guard and the rule never fired.
    const ruleId = 'r-moving';
    await rules.save({
      id: ruleId,
      profileId: 'profile-1',
      name: 'close moving up',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.Moving,
          operator: MovingOperator.MovingUp,
          left: { kind: OperandKind.Close },
          threshold: 5,
          lookbackBars: 1,
          interval: Period.OneMinute,
        },
      },
      trigger: { kind: TriggerKind.OncePerBarClose, period: Period.OneMinute },
      expiration: null,
      actions: [
        {
          kind: ActionKind.SetSymbolState,
          key: 'moved',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
      enabled: true,
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    });

    await candles.save('AAPL', Period.OneMinute, [
      { time: 60_000, open: 100, high: 100, low: 100, close: 100, volume: 10 },
      { time: 120_000, open: 110, high: 110, low: 110, close: 110, volume: 10 },
    ]);

    const wired = await wireRuleEngine({
      rules,
      oncePerBarLatch: new InMemoryOncePerBarLatchStore(),
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository: candles,
      indicatorStore,
    });

    wired.barBridge.handleCandle({
      id: 'AAPL',
      period: Period.OneMinute,
      candle: { time: 120_000, open: 110, high: 110, low: 110, close: 110, volume: 10 },
      final: true,
    });
    await wired.drain();

    const ruleEvents = await eventLog.ruleEvents(ruleId);
    expect(ruleEvents.map((e) => e.type)).toEqual([RuleEventType.StateSet, RuleEventType.Fired]);
    expect(await state.getSymbolState('profile-1', 'AAPL', 'moved')).toEqual({
      type: StateValueType.Bool,
      value: true,
    });
  });

  it('does not fire a MovingUp rule when the close delta across the lookback window is below the threshold (regression #499)', async () => {
    // Same wiring path as above; the two bars move 100 → 110 (delta 10) but the
    // threshold is 50, so the operator computes a real delta and stays false —
    // proving the fire in the positive case is the movement, not a wiring
    // accident.
    const ruleId = 'r-moving-quiet';
    await rules.save({
      id: ruleId,
      profileId: 'profile-1',
      name: 'close moving up a lot',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.Moving,
          operator: MovingOperator.MovingUp,
          left: { kind: OperandKind.Close },
          threshold: 50,
          lookbackBars: 1,
          interval: Period.OneMinute,
        },
      },
      trigger: { kind: TriggerKind.OncePerBarClose, period: Period.OneMinute },
      expiration: null,
      actions: [
        {
          kind: ActionKind.SetSymbolState,
          key: 'moved',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
      enabled: true,
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    });

    await candles.save('AAPL', Period.OneMinute, [
      { time: 60_000, open: 100, high: 100, low: 100, close: 100, volume: 10 },
      { time: 120_000, open: 110, high: 110, low: 110, close: 110, volume: 10 },
    ]);

    const wired = await wireRuleEngine({
      rules,
      oncePerBarLatch: new InMemoryOncePerBarLatchStore(),
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository: candles,
      indicatorStore,
    });

    wired.barBridge.handleCandle({
      id: 'AAPL',
      period: Period.OneMinute,
      candle: { time: 120_000, open: 110, high: 110, low: 110, close: 110, volume: 10 },
      final: true,
    });
    await wired.drain();

    expect(await eventLog.ruleEvents(ruleId)).toEqual([]);
    expect(await state.getSymbolState('profile-1', 'AAPL', 'moved')).toBeNull();
  });

  it('fires a MovingUp rule on the bar under evaluation even when the repository holds a later-ts candle (window is bounded to the firing bar, #499)', async () => {
    // Regression: the live context warms the bar series from the candle
    // repository over `[0, firing-bar-ts]`, not the whole store. A candle
    // stored *after* the bar under evaluation — a later bar the store already
    // holds, or leftover data from another run against a shared store — must
    // not become the series' newest point, or the operator reads it as the
    // "current" bar and computes the wrong delta (here 90 → 200 across the
    // lookback would flip a real +100 move into a false −110).
    const ruleId = 'r-moving-bounded';
    await rules.save({
      id: ruleId,
      profileId: 'profile-1',
      name: 'close moving up',
      scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
      condition: {
        kind: ConditionNodeKind.Leaf,
        leaf: {
          family: LeafConditionFamily.Moving,
          operator: MovingOperator.MovingUp,
          left: { kind: OperandKind.Close },
          threshold: 5,
          lookbackBars: 1,
          interval: Period.OneMinute,
        },
      },
      trigger: { kind: TriggerKind.OncePerBarClose, period: Period.OneMinute },
      expiration: null,
      actions: [
        {
          kind: ActionKind.SetSymbolState,
          key: 'moved',
          value: { type: StateValueType.Bool, value: true },
        },
      ],
      enabled: true,
      order: 1,
      createdAt: 0,
      updatedAt: 0,
    });

    // Bars 60_000 → 120_000 move 90 → 200 (delta 110 ≥ 5). A later-ts candle at
    // 180_000 (close 90) already sits in the store; an unbounded window would
    // read it as "current" and compute 90 − 200 = −110, never firing.
    await candles.save('AAPL', Period.OneMinute, [
      { time: 60_000, open: 90, high: 90, low: 90, close: 90, volume: 10 },
      { time: 180_000, open: 90, high: 90, low: 90, close: 90, volume: 10 },
      { time: 120_000, open: 200, high: 200, low: 200, close: 200, volume: 10 },
    ]);

    const wired = await wireRuleEngine({
      rules,
      oncePerBarLatch: new InMemoryOncePerBarLatchStore(),
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository: candles,
      indicatorStore,
    });

    wired.barBridge.handleCandle({
      id: 'AAPL',
      period: Period.OneMinute,
      candle: { time: 120_000, open: 200, high: 200, low: 200, close: 200, volume: 10 },
      final: true,
    });
    await wired.drain();

    expect((await eventLog.ruleEvents(ruleId)).map((e) => e.type)).toEqual([
      RuleEventType.StateSet,
      RuleEventType.Fired,
    ]);
    expect(await state.getSymbolState('profile-1', 'AAPL', 'moved')).toEqual({
      type: StateValueType.Bool,
      value: true,
    });
  });

  it('resolves cleanly with no rules persisted (no profiles to warm)', async () => {
    const wired = await wireRuleEngine({
      rules,
      oncePerBarLatch: new InMemoryOncePerBarLatchStore(),
      state,
      watchlist,
      eventLog,
      notifier,
      candleRepository: candles,
      indicatorStore,
    });

    // Sanity: the engine is usable and the mirror is empty.
    expect(wired.lookups.getSymbolState('profile-1', 'AAPL', 'anything')).toBeNull();
    expect(wired.lookups.getGlobalState('profile-1', 'anything')).toBeNull();
  });

  /**
   * Build one 1m crypto candle at `time` whose OHLC are all `close` — the SMA
   * memo tests only care about the close series.
   */
  const smaCandle = (time: number, close: number) => ({
    type: SymbolType.Crypto,
    time,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
    quoteVolume: close,
    trades: 1,
  });

  /**
   * A `BTC` rule whose condition compares the shared SMA operand against 0 on
   * the 1m interval, so evaluating it always reads the indicator operand (and
   * therefore drives one `IndicatorService.compute`).
   */
  const indicatorRule = (id: string, order: number, trigger: Trigger): Rule => ({
    id,
    profileId: 'profile-1',
    name: id,
    scope: { kind: RuleScopeKind.Symbol, symbolId: 'BTC' },
    condition: {
      kind: ConditionNodeKind.Leaf,
      leaf: {
        family: LeafConditionFamily.Comparison,
        operator: ComparisonOperator.Gt,
        left: {
          kind: OperandKind.IndicatorRef,
          instanceId: SMA_INSTANCE_ID,
          stateKey: 'value',
          valueType: StateValueType.Number,
        },
        right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
        interval: Period.OneMinute,
      },
    },
    trigger,
    expiration: null,
    actions: [],
    enabled: true,
    order,
    createdAt: 0,
    updatedAt: 0,
  });

  /**
   * Wire a live engine over a real SMA(3) instance for `BTC`, seeding `closes`
   * as 1m candles and recording every `IndicatorService.compute` call so a test
   * can assert how many times the shared operand was computed.
   */
  const wireIndicatorEngine = async (
    closes: ReadonlyArray<[number, number]>,
  ): Promise<{
    wired: Awaited<ReturnType<typeof wireRuleEngine>>;
    computeCalls: unknown[][];
  }> => {
    const repo = new InMemoryCandleRepository();
    await repo.save(
      'BTC',
      Period.OneMinute,
      closes.map(([time, close]) => smaCandle(time, close)),
    );
    const cryptoWatchlist = new InMemoryWatchlistRepository([
      {
        id: 'BTC',
        type: SymbolType.Crypto,
        description: 'BTC',
        exchange: 'Binance',
        periods: [Period.OneMinute],
      },
    ]);
    const registry = new IndicatorRegistry();
    registry.register(movingAverage);
    const realService = new IndicatorService(registry, cryptoWatchlist, repo);
    const computeCalls: unknown[][] = [];
    // Record every compute call while delegating to the real service — the
    // `Object.create` + method-override idiom this file already uses for the
    // corrupt-repository regression test.
    const recordingService: IndicatorService = Object.create(realService);
    recordingService.compute = (...args: Parameters<IndicatorService['compute']>) => {
      computeCalls.push(args);
      return realService.compute(...args);
    };
    const store = new IndicatorSeriesStore(repo, recordingService);
    store.register({ instanceId: SMA_INSTANCE_ID, indicatorKey: 'sma', inputs: { ...SMA_INPUTS } });

    const wired = await wireRuleEngine({
      rules,
      oncePerBarLatch: new InMemoryOncePerBarLatchStore(),
      state,
      watchlist: cryptoWatchlist,
      eventLog,
      notifier,
      candleRepository: repo,
      indicatorStore: store,
    });
    return { wired, computeCalls };
  };

  it('computes a shared indicator operand once for a candle that fans into BarOpened, BarClosed, and a Tick (regression #548)', async () => {
    // Three rules reference the same SMA operand, one per fanned event kind:
    // BarOpened, BarClosed, and the per-poll Tick. Each evaluation reads the
    // operand; the per-observation memo collapses all three to one compute.
    await rules.save(
      indicatorRule('r-open', 1, { kind: TriggerKind.OncePerBarOpen, period: Period.OneMinute }),
    );
    await rules.save(
      indicatorRule('r-close', 2, { kind: TriggerKind.OncePerBarClose, period: Period.OneMinute }),
    );
    await rules.save(indicatorRule('r-tick', 3, { kind: TriggerKind.EveryTime }));

    const { wired, computeCalls } = await wireIndicatorEngine([
      [60_000, 10],
      [120_000, 20],
      [180_000, 30],
    ]);

    wired.barBridge.handleCandle({
      id: 'BTC',
      period: Period.OneMinute,
      candle: { time: 180_000, open: 30, high: 30, low: 30, close: 30, volume: 1 },
      final: true,
    });
    await wired.drain();

    expect(computeCalls).toEqual([
      [
        'BTC',
        'sma',
        { length: 3, source: 'close' },
        Period.OneMinute,
        { from: 60_000, to: 180_001 },
      ],
    ]);
  });

  it('recomputes the shared indicator operand on the next bar because the memo is scoped to one observation (regression #548)', async () => {
    // The same three fanned rules as above, fed two consecutive bars. Within a
    // bar the memo collapses BarOpened + BarClosed + Tick to one compute; across
    // bars the first memo dies with its batch and the wider window keys a fresh
    // compute — so exactly one compute per bar, each over its own window, and no
    // stale value leaks across bars.
    await rules.save(
      indicatorRule('r-open', 1, { kind: TriggerKind.OncePerBarOpen, period: Period.OneMinute }),
    );
    await rules.save(
      indicatorRule('r-close', 2, { kind: TriggerKind.OncePerBarClose, period: Period.OneMinute }),
    );
    await rules.save(indicatorRule('r-tick', 3, { kind: TriggerKind.EveryTime }));

    const { wired, computeCalls } = await wireIndicatorEngine([
      [60_000, 10],
      [120_000, 20],
      [180_000, 30],
      [240_000, 40],
    ]);

    wired.barBridge.handleCandle({
      id: 'BTC',
      period: Period.OneMinute,
      candle: { time: 180_000, open: 30, high: 30, low: 30, close: 30, volume: 1 },
      final: true,
    });
    await wired.drain();
    wired.barBridge.handleCandle({
      id: 'BTC',
      period: Period.OneMinute,
      candle: { time: 240_000, open: 40, high: 40, low: 40, close: 40, volume: 1 },
      final: true,
    });
    await wired.drain();

    expect(computeCalls).toEqual([
      [
        'BTC',
        'sma',
        { length: 3, source: 'close' },
        Period.OneMinute,
        { from: 60_000, to: 180_001 },
      ],
      [
        'BTC',
        'sma',
        { length: 3, source: 'close' },
        Period.OneMinute,
        { from: 60_000, to: 240_001 },
      ],
    ]);
  });
});
