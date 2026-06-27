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
 * E2e for #322 — covers `RuleScopeKind.AllSymbols` fan-out across multiple
 * symbols and the `RuleScopeKind.Symbol` negative case (a symbol-scoped
 * rule does not react to events for a different symbol). Also covers
 * cross-profile state-cascade partitioning (regression for #281).
 */

const AAPL = 'stock:AAPL';
const MSFT = 'stock:MSFT';
const PROFILE_A = 'profile-A';
const PROFILE_B = 'profile-B';

const BUY = { type: StateValueType.Enum as const, value: 'BUY' };

function buildDriver(seedRules: Rule[]) {
  const rules = new InMemoryRuleRepository(seedRules);
  const watchlist = new InMemoryWatchlistRepository();
  const state = new InMemoryStateRepository();
  const notifier = new InMemoryNotifier(['main']);
  const eventLog = new InMemoryEventLog(() => 999);
  const firingState = new InMemoryFiringStateRepository();
  const wired = wireRuleEngine({ rules, watchlist, state, notifier, eventLog, firingState });
  return { rules, state, notifier, eventLog, wired };
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

describe('rule scope: AllSymbols / Symbol (e2e)', () => {
  it('`AllSymbols` rule with `price > 0` fires for both AAPL and MSFT quotes', async () => {
    const driver = buildDriver([
      {
        id: 'fan-out',
        profileId: PROFILE_A,
        name: 'fan-out',
        scope: { kind: RuleScopeKind.AllSymbols },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
          operator: NumericOperator.Gt,
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
        },
        // OncePerBar(1m) so a fire on AAPL doesn't auto-disable and gate a
        // subsequent fire on MSFT.
        trigger: { kind: TriggerKind.OncePerBar, period: Period.OneMinute },
        expiration: null,
        actions: [
          { kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'fan-out' },
        ],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 1,
      },
    ]);

    await pushQuote(driver, AAPL, 100, 1_000);
    await pushQuote(driver, MSFT, 200, 2_000);

    const aaplFires = (await driver.eventLog.symbolEvents(AAPL)).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    const msftFires = (await driver.eventLog.symbolEvents(MSFT)).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    expect({
      notified: driver.notifier.sent,
      aaplFires: aaplFires.length,
      msftFires: msftFires.length,
      aaplSymbol: aaplFires[0]?.symbolId,
      msftSymbol: msftFires[0]?.symbolId,
    }).toEqual({
      notified: [
        { destinationName: 'main', body: 'fan-out' },
        { destinationName: 'main', body: 'fan-out' },
      ],
      aaplFires: 1,
      msftFires: 1,
      aaplSymbol: AAPL,
      msftSymbol: MSFT,
    });
  });

  it('`Symbol(AAPL)` rule is silent on an MSFT quote and fires on an AAPL quote', async () => {
    const driver = buildDriver([
      {
        id: 'aapl-only',
        profileId: PROFILE_A,
        name: 'aapl-only',
        scope: { kind: RuleScopeKind.Symbol, symbolId: AAPL },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
          operator: NumericOperator.Gt,
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
        },
        trigger: { kind: TriggerKind.OncePerBar, period: Period.OneMinute },
        expiration: null,
        actions: [
          { kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'aapl-only' },
        ],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 1,
      },
    ]);

    // MSFT first — rule must not react because its scope is bound to AAPL.
    await pushQuote(driver, MSFT, 200, 1_000);
    // Then AAPL — rule fires.
    await pushQuote(driver, AAPL, 100, 2_000);

    const aaplFires = (await driver.eventLog.symbolEvents(AAPL)).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    const msftFires = (await driver.eventLog.symbolEvents(MSFT)).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    expect({
      notified: driver.notifier.sent,
      aaplFires: aaplFires.length,
      msftFires: msftFires.length,
    }).toEqual({
      notified: [{ destinationName: 'main', body: 'aapl-only' }],
      aaplFires: 1,
      msftFires: 0,
    });
  });

  it('cross-profile partitioning — an `AllSymbols` reader in profile A stays silent when profile B writes its own `state.signal`', async () => {
    const driver = buildDriver([
      // Profile B writer: fires on AAPL @ 10, writes profile-B's signal=BUY.
      {
        id: 'b-writer',
        profileId: PROFILE_B,
        name: 'b-writer',
        scope: { kind: RuleScopeKind.Symbol, symbolId: AAPL },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
          operator: NumericOperator.Eq,
          right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 10 } },
        },
        trigger: { kind: TriggerKind.Once },
        expiration: null,
        actions: [{ kind: ActionKind.SetSymbolState, key: 'signal', value: BUY }],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 1,
      },
      // Profile A reader: AllSymbols rule listening on `signal == BUY`. The
      // cascade event from profile B's write carries `profileId: B`, so the
      // orchestrator filters this reader out (per #281) and it never fires.
      {
        id: 'a-reader',
        profileId: PROFILE_A,
        name: 'a-reader',
        scope: { kind: RuleScopeKind.AllSymbols },
        condition: {
          kind: ConditionNodeKind.Leaf,
          left: {
            kind: OperandKind.SymbolStateRef,
            key: 'signal',
            valueType: StateValueType.Enum,
          },
          operator: StateOperator.Equals,
          right: { kind: OperandKind.Literal, value: BUY },
        },
        trigger: { kind: TriggerKind.OncePerBar, period: Period.OneMinute },
        expiration: null,
        actions: [
          { kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'a-reader' },
        ],
        enabled: true,
        events: [],
        history: [],
        createdAt: 0,
        updatedAt: 0,
        order: 2,
      },
    ]);

    await pushQuote(driver, AAPL, 10, 1_000);

    const writerFires = (await driver.eventLog.ruleEvents('b-writer')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    const readerFires = (await driver.eventLog.ruleEvents('a-reader')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    expect({
      notified: driver.notifier.sent,
      writerFires: writerFires.length,
      readerFires: readerFires.length,
    }).toEqual({
      // Writer has no telegram action; reader never fires → notifier empty.
      notified: [],
      writerFires: 1,
      readerFires: 0,
    });
  });
});
