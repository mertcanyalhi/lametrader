import {
  ActionKind,
  ConditionNodeKind,
  NumericOperator,
  OperandKind,
  Period,
  type Rule,
  RuleEventKind,
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
  type EvaluationLookups,
  InMemoryEventLog,
  InMemoryFiringStateRepository,
  InMemoryNotifier,
  InMemoryRuleRepository,
  InMemoryStateRepository,
  InMemoryWatchlistRepository,
  QuoteRuleEventBridge,
  RuleOrchestrator,
  type RuleOrchestratorOptions,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';

/**
 * E2e: drive `SymbolQuoteEvent`s through a real {@link QuoteRuleEventBridge}
 * into {@link RuleOrchestrator} wired against the in-memory adapter family,
 * asserting end-user-visible outcomes (notifier sends, event log entries).
 *
 * Mongo coverage for the persistence ports already lives in the
 * repository-contract e2e suites; this suite focuses on the orchestration
 * path itself end-to-end.
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
    actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: overrides.id }],
    enabled: true,
    events: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/** Build a `SymbolQuoteEvent` for AAPL on the 1m period. */
function quote(price: number, time = 1000, final = false): SymbolQuoteEvent {
  return {
    subscriptionId: 'sub-1',
    id: 'AAPL',
    period: Period.OneMinute,
    quote: { price, change: 0, changePct: 0, time },
    final,
  };
}

/**
 * End-to-end harness: a {@link QuoteRuleEventBridge} feeding a real
 * {@link RuleOrchestrator} backed by every in-memory adapter; lookups are
 * kept in sync via an `onStateChanged` subscription so cascaded state writes
 * are visible on the next event without a separate process.
 */
function buildDriver(
  seedRules: Rule[],
  options: { orchestratorOptions?: RuleOrchestratorOptions; watched?: string[] } = {},
) {
  const notifier = new InMemoryNotifier(['main']);
  const log = new InMemoryEventLog();
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
    ...emptyLookups(),
    getCurrentValue: (id) => currentValues.get(id) ?? null,
    getSymbolState: (profileId, id, key) => symbolState.get(`${profileId}|${id}|${key}`) ?? null,
  };
  const orchestrator = new RuleOrchestrator(
    rules,
    watchlist,
    lookups,
    state,
    notifier,
    log,
    firingState,
    options.orchestratorOptions,
  );
  let pending: Promise<void> = Promise.resolve();
  const bridge = new QuoteRuleEventBridge((event) => {
    pending = pending.then(() => orchestrator.process(event));
  });
  return {
    notifier,
    log,
    async push(q: SymbolQuoteEvent): Promise<void> {
      currentValues.set(q.id, q.quote.price);
      bridge.handleQuote(q);
      await pending;
    },
  };
}

describe('rule orchestrator (e2e)', () => {
  it('fires a symbol-scoped rule on an inbound quote routed through QuoteRuleEventBridge', async () => {
    const r = rule({ id: 'above-zero', order: 1 });
    const driver = buildDriver([r]);

    await driver.push(quote(100));

    expect(driver.notifier.sent).toEqual([{ destinationName: 'main', body: 'above-zero' }]);
    const fires = (await driver.log.ruleEvents('above-zero')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    expect(fires).toEqual([
      {
        type: RuleEventType.Fired,
        ts: 1000,
        ruleId: 'above-zero',
        symbolId: 'AAPL',
        context: {
          inboundEvent: {
            kind: RuleEventKind.CurrentValueChanged,
            ts: 1000,
            symbolId: 'AAPL',
            prev: null,
            current: 100,
            final: false,
          },
          lookupSnapshot: {
            current: 100,
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

  it('cascades a SetSymbolState action into a downstream rule in the same process() tick', async () => {
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
    const driver = buildDriver([trigger, downstream]);

    await driver.push(quote(100));

    expect(driver.notifier.sent).toEqual([{ destinationName: 'main', body: 'cascaded' }]);
  });

  it('records exactly one CycleOverflow event and halts further cascading when the cycle limit is breached', async () => {
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
    const driver = buildDriver([a, b], { orchestratorOptions: { cycleLimit: 1 } });

    await driver.push(quote(100));

    const overflows = (await driver.log.ruleEvents('A')).filter(
      (event) => event.type === RuleEventType.CycleOverflow,
    );
    const symbolOverflows = (await driver.log.symbolEvents('AAPL')).filter(
      (event) => event.type === RuleEventType.CycleOverflow,
    );
    expect(symbolOverflows).toEqual([
      {
        type: RuleEventType.CycleOverflow,
        ts: 1000,
        ruleId: '',
        symbolId: 'AAPL',
        cycleLimit: 1,
      },
    ]);
    expect(overflows).toEqual([]);
  });

  it('emits exactly one Expired event per (rule, symbol) across multiple inbound quotes past the expiration', async () => {
    const expired = rule({ id: 'expired', order: 1, expiration: { at: 500 } });
    const driver = buildDriver([expired]);

    await driver.push(quote(100, 1000));
    await driver.push(quote(101, 2000));
    await driver.push(quote(102, 3000));

    expect(driver.notifier.sent).toEqual([]);
    const expiredEvents = (await driver.log.ruleEvents('expired')).filter(
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
});
