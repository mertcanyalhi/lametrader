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
  StateValueType,
  type SymbolQuoteEvent,
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
 * E2e for #318 — covers each non-crossing `NumericOperator` at boundary
 * values (threshold-equal, threshold ± 1) end-to-end via real
 * `QuoteRuleEventBridge` → `RuleOrchestrator`.
 *
 * Every test uses `Once × CurrentValue` with `threshold = 100`. The
 * suite pushes `SymbolQuoteEvent`s in an order that lets the
 * `Once`-trigger auto-disable double as the assertion that the
 * operator only matched the values its semantics demand: at-or-before
 * the first value the operator deems true, the rule sits silent; on
 * that value it fires once; from that point on no quote can refire it.
 */

const SYMBOL_ID = 'stock:AAPL';
const PROFILE_ID = 'profile-1';

function rule(id: string, operator: NumericOperator): Rule {
  return {
    id,
    profileId: PROFILE_ID,
    name: id,
    scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
    condition: {
      kind: ConditionNodeKind.Leaf,
      left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
      operator,
      right: {
        kind: OperandKind.Literal,
        value: { type: StateValueType.Number, value: 100 },
      },
    },
    trigger: { kind: TriggerKind.Once },
    expiration: null,
    actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: id }],
    enabled: true,
    events: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
    order: 1,
  };
}

function buildDriver(seedRule: Rule) {
  const rules = new InMemoryRuleRepository([seedRule]);
  const watchlist = new InMemoryWatchlistRepository();
  const state = new InMemoryStateRepository();
  const notifier = new InMemoryNotifier(['main']);
  const eventLog = new InMemoryEventLog(() => 999);
  const firingState = new InMemoryFiringStateRepository();
  const wired = wireRuleEngine({ rules, watchlist, state, notifier, eventLog, firingState });
  return { rules, notifier, eventLog, wired };
}

function quote(price: number, time: number): SymbolQuoteEvent {
  return {
    subscriptionId: 's',
    id: SYMBOL_ID,
    period: Period.OneMinute,
    quote: { price, change: 0, changePct: 0, time },
    final: false,
  };
}

async function pushQuote(
  driver: ReturnType<typeof buildDriver>,
  price: number,
  time: number,
): Promise<void> {
  driver.wired.quoteBridge.handleQuote(quote(price, time));
  await driver.wired.drain();
}

describe('numeric operators at boundary values (e2e)', () => {
  it('`Gt 100` does not fire at 99 or 100; fires on the strictly-greater 101', async () => {
    const driver = buildDriver(rule('gt-100', NumericOperator.Gt));

    await pushQuote(driver, 99, 1_000);
    await pushQuote(driver, 100, 2_000);
    await pushQuote(driver, 101, 3_000);

    const fired = (await driver.eventLog.ruleEvents('gt-100')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    const stored = await driver.rules.get('gt-100');
    expect({ notified: driver.notifier.sent, fired, enabled: stored?.enabled }).toEqual({
      notified: [{ destinationName: 'main', body: 'gt-100' }],
      fired: [
        {
          type: RuleEventType.Fired,
          ts: 3_000,
          ruleId: 'gt-100',
          symbolId: SYMBOL_ID,
          firedAt: 999,
          context: {
            inboundEvent: {
              kind: RuleEventKind.CurrentValueChanged,
              ts: 3_000,
              symbolId: SYMBOL_ID,
              prev: 100,
              current: 101,
              final: false,
            },
            lookupSnapshot: {
              current: 101,
              open: null,
              high: null,
              low: null,
              close: null,
              volume: null,
            },
          },
        },
      ],
      enabled: false,
    });
  });

  it('`Lt 100` does not fire at 101 or 100; fires on the strictly-less 99', async () => {
    const driver = buildDriver(rule('lt-100', NumericOperator.Lt));

    await pushQuote(driver, 101, 1_000);
    await pushQuote(driver, 100, 2_000);
    await pushQuote(driver, 99, 3_000);

    const fired = (await driver.eventLog.ruleEvents('lt-100')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    const stored = await driver.rules.get('lt-100');
    expect({ notified: driver.notifier.sent, fired, enabled: stored?.enabled }).toEqual({
      notified: [{ destinationName: 'main', body: 'lt-100' }],
      fired: [
        {
          type: RuleEventType.Fired,
          ts: 3_000,
          ruleId: 'lt-100',
          symbolId: SYMBOL_ID,
          firedAt: 999,
          context: {
            inboundEvent: {
              kind: RuleEventKind.CurrentValueChanged,
              ts: 3_000,
              symbolId: SYMBOL_ID,
              prev: 100,
              current: 99,
              final: false,
            },
            lookupSnapshot: {
              current: 99,
              open: null,
              high: null,
              low: null,
              close: null,
              volume: null,
            },
          },
        },
      ],
      enabled: false,
    });
  });

  it('`Gte 100` does not fire at 99; fires at the inclusive boundary 100', async () => {
    const driver = buildDriver(rule('gte-100', NumericOperator.Gte));

    await pushQuote(driver, 99, 1_000);
    await pushQuote(driver, 100, 2_000);

    const fired = (await driver.eventLog.ruleEvents('gte-100')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    const stored = await driver.rules.get('gte-100');
    expect({ notified: driver.notifier.sent, fired, enabled: stored?.enabled }).toEqual({
      notified: [{ destinationName: 'main', body: 'gte-100' }],
      fired: [
        {
          type: RuleEventType.Fired,
          ts: 2_000,
          ruleId: 'gte-100',
          symbolId: SYMBOL_ID,
          firedAt: 999,
          context: {
            inboundEvent: {
              kind: RuleEventKind.CurrentValueChanged,
              ts: 2_000,
              symbolId: SYMBOL_ID,
              prev: 99,
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
      ],
      enabled: false,
    });
  });

  it('`Lte 100` does not fire at 101; fires at the inclusive boundary 100', async () => {
    const driver = buildDriver(rule('lte-100', NumericOperator.Lte));

    await pushQuote(driver, 101, 1_000);
    await pushQuote(driver, 100, 2_000);

    const fired = (await driver.eventLog.ruleEvents('lte-100')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    const stored = await driver.rules.get('lte-100');
    expect({ notified: driver.notifier.sent, fired, enabled: stored?.enabled }).toEqual({
      notified: [{ destinationName: 'main', body: 'lte-100' }],
      fired: [
        {
          type: RuleEventType.Fired,
          ts: 2_000,
          ruleId: 'lte-100',
          symbolId: SYMBOL_ID,
          firedAt: 999,
          context: {
            inboundEvent: {
              kind: RuleEventKind.CurrentValueChanged,
              ts: 2_000,
              symbolId: SYMBOL_ID,
              prev: 101,
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
      ],
      enabled: false,
    });
  });

  it('`Eq 100` does not fire at 99 or 101; fires at exact 100', async () => {
    const driver = buildDriver(rule('eq-100', NumericOperator.Eq));

    await pushQuote(driver, 99, 1_000);
    await pushQuote(driver, 101, 2_000);
    await pushQuote(driver, 100, 3_000);

    const fired = (await driver.eventLog.ruleEvents('eq-100')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    const stored = await driver.rules.get('eq-100');
    expect({ notified: driver.notifier.sent, fired, enabled: stored?.enabled }).toEqual({
      notified: [{ destinationName: 'main', body: 'eq-100' }],
      fired: [
        {
          type: RuleEventType.Fired,
          ts: 3_000,
          ruleId: 'eq-100',
          symbolId: SYMBOL_ID,
          firedAt: 999,
          context: {
            inboundEvent: {
              kind: RuleEventKind.CurrentValueChanged,
              ts: 3_000,
              symbolId: SYMBOL_ID,
              prev: 101,
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
      ],
      enabled: false,
    });
  });

  it('`Neq 100` does not fire at exact 100; fires at the first not-equal 99', async () => {
    const driver = buildDriver(rule('neq-100', NumericOperator.Neq));

    await pushQuote(driver, 100, 1_000);
    await pushQuote(driver, 99, 2_000);

    const fired = (await driver.eventLog.ruleEvents('neq-100')).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    const stored = await driver.rules.get('neq-100');
    expect({ notified: driver.notifier.sent, fired, enabled: stored?.enabled }).toEqual({
      notified: [{ destinationName: 'main', body: 'neq-100' }],
      fired: [
        {
          type: RuleEventType.Fired,
          ts: 2_000,
          ruleId: 'neq-100',
          symbolId: SYMBOL_ID,
          firedAt: 999,
          context: {
            inboundEvent: {
              kind: RuleEventKind.CurrentValueChanged,
              ts: 2_000,
              symbolId: SYMBOL_ID,
              prev: 100,
              current: 99,
              final: false,
            },
            lookupSnapshot: {
              current: 99,
              open: null,
              high: null,
              low: null,
              close: null,
              volume: null,
            },
          },
        },
      ],
      enabled: false,
    });
  });
});
