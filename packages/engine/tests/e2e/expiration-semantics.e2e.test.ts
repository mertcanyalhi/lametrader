import {
  ActionKind,
  ConditionNodeKind,
  NumericOperator,
  OperandKind,
  Period,
  type Rule,
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
  wireRuleEngine,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';

/**
 * E2e for #328 — `expiration: { at }` semantics:
 *
 * - past expiration (Symbol scope) — three qualifying quotes past `at`
 *   produce one `Expired` event (not three), no notifier send, no fires;
 * - future expiration (Symbol scope) — qualifying quote inside the
 *   window fires normally and records no `Expired` event;
 * - past expiration (`AllSymbols` scope, two watched symbols) — one
 *   `Expired` event per `(rule, symbol)` pair; subsequent quotes on
 *   either symbol do not emit additional `Expired` events;
 * - expiration vs cascade — a downstream rule that would cascade off an
 *   expired upstream rule's `SetSymbolState` does not fire because the
 *   upstream's action chain is skipped entirely.
 */

const AAPL = 'stock:AAPL';
const MSFT = 'stock:MSFT';
const PROFILE_ID = 'profile-1';

const BUY = { type: StateValueType.Enum as const, value: 'BUY' };

function buildDriver(seedRules: Rule[]) {
  const rules = new InMemoryRuleRepository(seedRules);
  const watchlist = new InMemoryWatchlistRepository([
    {
      id: AAPL,
      type: SymbolType.Stock,
      description: 'Apple',
      exchange: 'NMS',
      periods: [Period.OneMinute],
    },
    {
      id: MSFT,
      type: SymbolType.Stock,
      description: 'Microsoft',
      exchange: 'NMS',
      periods: [Period.OneMinute],
    },
  ]);
  const state = new InMemoryStateRepository();
  const notifier = new InMemoryNotifier(['main']);
  const eventLog = new InMemoryEventLog(() => 999);
  const firingState = new InMemoryFiringStateRepository();
  const wired = wireRuleEngine({ rules, watchlist, state, notifier, eventLog, firingState });
  return { rules, notifier, eventLog, wired };
}

async function pushQuote(
  driver: ReturnType<typeof buildDriver>,
  symbolId: string,
  price: number,
  time: number,
): Promise<void> {
  driver.wired.quoteBridge.handleQuote({
    subscriptionId: 's',
    id: symbolId,
    period: Period.OneMinute,
    quote: { price, change: 0, changePct: 0, time },
    final: false,
  });
  await driver.wired.drain();
}

describe('expiration semantics (e2e)', () => {
  it('past expiration (Symbol scope) — three qualifying quotes past `at` emit one `Expired` event total', async () => {
    const driver = buildDriver([
      {
        id: 'past',
        profileId: PROFILE_ID,
        name: 'past',
        scope: { kind: RuleScopeKind.Symbol, symbolId: AAPL },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
          operator: NumericOperator.Gt,
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
        },
        trigger: { kind: TriggerKind.Once },
        expiration: { at: 500 },
        actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'past' }],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 1,
      },
    ]);

    await pushQuote(driver, AAPL, 100, 1_000);
    await pushQuote(driver, AAPL, 110, 2_000);
    await pushQuote(driver, AAPL, 120, 3_000);

    const expired = (await driver.eventLog.ruleEvents('past')).filter(
      (event) => event.type === RuleEventType.Expired,
    );
    const fired = (await driver.eventLog.ruleEvents('past')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    expect({
      notified: driver.notifier.sent,
      expiredCount: expired.length,
      firstExpired: expired[0],
      firedCount: fired.length,
    }).toEqual({
      notified: [],
      expiredCount: 1,
      firstExpired: {
        type: RuleEventType.Expired,
        ts: 1_000,
        ruleId: 'past',
        symbolId: AAPL,
        firedAt: 999,
      },
      firedCount: 0,
    });
  });

  it('future expiration (Symbol scope) — qualifying quote inside the window fires normally', async () => {
    const driver = buildDriver([
      {
        id: 'future',
        profileId: PROFILE_ID,
        name: 'future',
        scope: { kind: RuleScopeKind.Symbol, symbolId: AAPL },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
          operator: NumericOperator.Gt,
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
        },
        trigger: { kind: TriggerKind.Once },
        expiration: { at: 1_000_000 },
        actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'future' }],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 1,
      },
    ]);

    await pushQuote(driver, AAPL, 100, 1_000);

    const expired = (await driver.eventLog.ruleEvents('future')).filter(
      (event) => event.type === RuleEventType.Expired,
    );
    const fired = (await driver.eventLog.ruleEvents('future')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    expect({
      notified: driver.notifier.sent,
      expiredCount: expired.length,
      firedCount: fired.length,
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'future' }],
      expiredCount: 0,
      firedCount: 1,
    });
  });

  it('past expiration (`AllSymbols` scope) — exactly one `Expired` event per `(rule, symbol)` pair across two watched symbols', async () => {
    const driver = buildDriver([
      {
        id: 'all-past',
        profileId: PROFILE_ID,
        name: 'all-past',
        scope: { kind: RuleScopeKind.AllSymbols },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
          operator: NumericOperator.Gt,
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
        },
        trigger: { kind: TriggerKind.OncePerBar, period: Period.OneMinute },
        expiration: { at: 500 },
        actions: [
          { kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'all-past' },
        ],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 1,
      },
    ]);

    // Two AAPL quotes past expiration, two MSFT quotes past expiration —
    // one Expired per (rule, symbol).
    await pushQuote(driver, AAPL, 100, 1_000);
    await pushQuote(driver, AAPL, 110, 2_000);
    await pushQuote(driver, MSFT, 200, 3_000);
    await pushQuote(driver, MSFT, 210, 4_000);

    const aaplExpired = (await driver.eventLog.symbolEvents(AAPL)).filter(
      (event) => event.type === RuleEventType.Expired && event.ruleId === 'all-past',
    );
    const msftExpired = (await driver.eventLog.symbolEvents(MSFT)).filter(
      (event) => event.type === RuleEventType.Expired && event.ruleId === 'all-past',
    );
    expect({
      notified: driver.notifier.sent,
      aaplExpired: aaplExpired.length,
      msftExpired: msftExpired.length,
    }).toEqual({
      notified: [],
      aaplExpired: 1,
      msftExpired: 1,
    });
  });

  it('expiration vs cascade — a downstream rule does not fire when the upstream expired rule skips its `SetSymbolState` action', async () => {
    const driver = buildDriver([
      // Upstream — past expiration, would have set `state.signal = BUY`.
      {
        id: 'upstream',
        profileId: PROFILE_ID,
        name: 'upstream',
        scope: { kind: RuleScopeKind.Symbol, symbolId: AAPL },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
          operator: NumericOperator.Gt,
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
        },
        trigger: { kind: TriggerKind.Once },
        expiration: { at: 500 },
        actions: [{ kind: ActionKind.SetSymbolState, key: 'signal', value: BUY }],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 1,
      },
      // Downstream — would have fired on `signal == BUY`.
      {
        id: 'downstream',
        profileId: PROFILE_ID,
        name: 'downstream',
        scope: { kind: RuleScopeKind.Symbol, symbolId: AAPL },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.SymbolStateRef, key: 'signal', valueType: StateValueType.Enum },
          operator: StateOperator.Equals,
          right: { kind: OperandKind.Literal, value: BUY },
        },
        trigger: { kind: TriggerKind.Once },
        expiration: null,
        actions: [
          { kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'downstream' },
        ],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 2,
      },
    ]);

    await pushQuote(driver, AAPL, 100, 1_000);

    const upstreamFired = (await driver.eventLog.ruleEvents('upstream')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    const downstreamFired = (await driver.eventLog.ruleEvents('downstream')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    expect({
      notified: driver.notifier.sent,
      upstreamFired: upstreamFired.length,
      downstreamFired: downstreamFired.length,
    }).toEqual({
      notified: [],
      upstreamFired: 0,
      downstreamFired: 0,
    });
  });
});
