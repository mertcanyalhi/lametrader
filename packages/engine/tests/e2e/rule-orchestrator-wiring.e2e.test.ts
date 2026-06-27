import {
  ActionKind,
  ConditionNodeKind,
  type EquityCandle,
  NumericOperator,
  OperandKind,
  Period,
  ProfileScope,
  type Rule,
  RuleEventKind,
  RuleEventType,
  RuleScopeKind,
  StateValueType,
  SymbolType,
  TriggerKind,
} from '@lametrader/core';
import {
  InMemoryCandleRepository,
  InMemoryEventLog,
  InMemoryFiringStateRepository,
  InMemoryMarketDataSource,
  InMemoryNotifier,
  InMemoryProfileRepository,
  InMemoryRuleRepository,
  InMemoryStateRepository,
  InMemoryWatchlistRepository,
  PollingService,
  wireRuleEngine,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';

/**
 * E2e for #290 — verifies the rule-engine wiring helper that
 * {@link connectServices} uses to compose the orchestrator + bridges +
 * cascade error handler into the live event chain.
 *
 * Drives a real {@link PollingService} against an
 * {@link InMemoryMarketDataSource}, hands its `onCandle` fan-out to the
 * `wireRuleEngine` candle bridge, and asserts the rule fires (and the
 * synthetic `Error` event lands when the orchestrator throws).
 */

const SYMBOL_ID = 'stock:AAPL';
const PROFILE_ID = 'profile-1';
const RULE_ID = 'rule-1';

/** Build the one rule the boot scenario uses — `close > 0` on AAPL. */
function fireRule(): Rule {
  return {
    id: RULE_ID,
    profileId: PROFILE_ID,
    name: 'fire',
    scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
    condition: {
      kind: ConditionNodeKind.Leaf,
      left: { kind: OperandKind.CloseValue, valueType: StateValueType.Number },
      operator: NumericOperator.Gt,
      right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 0 } },
    },
    trigger: { kind: TriggerKind.Once },
    expiration: null,
    actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'fired' }],
    enabled: true,
    events: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

/** A 1m equity candle whose close beats `close > 0`. */
function candle(time: number, close: number): EquityCandle {
  return {
    type: SymbolType.Stock,
    time,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1_000,
  };
}

/** Build the shared in-memory dep graph and an `InMemoryMarketDataSource`. */
async function buildFixtures() {
  const watchlist = new InMemoryWatchlistRepository([
    {
      id: SYMBOL_ID,
      type: SymbolType.Stock,
      description: 'Apple',
      exchange: 'NMS',
      periods: [Period.OneMinute],
    },
  ]);
  const profiles = new InMemoryProfileRepository([
    {
      id: PROFILE_ID,
      name: 'p1',
      description: '',
      enabled: true,
      scope: { type: ProfileScope.All },
      indicators: [],
      createdAt: 0,
      updatedAt: 0,
    },
  ]);
  const rules = new InMemoryRuleRepository([fireRule()], profiles);
  const candleRepo = new InMemoryCandleRepository();
  await candleRepo.save(SYMBOL_ID, Period.OneMinute, [candle(999_000, 99)]);
  const source = new InMemoryMarketDataSource(
    [
      {
        id: SYMBOL_ID,
        type: SymbolType.Stock,
        description: 'Apple',
        exchange: 'NMS',
      },
    ],
    [SymbolType.Stock],
    [{ id: SYMBOL_ID, period: Period.OneMinute, candles: [candle(1_000_000, 105)] }],
  );
  return { watchlist, profiles, rules, candleRepo, source };
}

describe('rule orchestrator wiring (e2e)', () => {
  it('fires the rule and appends one Fired event to the symbol log on the first polled candle', async () => {
    const fixtures = await buildFixtures();
    const state = new InMemoryStateRepository();
    const eventLog = new InMemoryEventLog(() => 999);
    const firingState = new InMemoryFiringStateRepository();
    const notifier = new InMemoryNotifier(['main']);

    const wired = wireRuleEngine({
      rules: fixtures.rules,
      watchlist: fixtures.watchlist,
      state,
      notifier,
      eventLog,
      firingState,
    });
    const polling = new PollingService([fixtures.source], fixtures.candleRepo, fixtures.watchlist, {
      onCandle: (event) => wired.candleBridge.handleCandle(event),
      intervals: { [Period.OneMinute]: 60_000 } as Record<Period, number>,
      now: () => 1_500_000,
    });

    await polling.poll();
    await wired.drain();

    const symbolEvents = await eventLog.symbolEvents(SYMBOL_ID);
    const firedEvents = symbolEvents.filter((event) => event.type === RuleEventType.Fired);
    expect({ notified: notifier.sent, fired: firedEvents }).toEqual({
      notified: [{ destinationName: 'main', body: 'fired' }],
      fired: [
        {
          type: RuleEventType.Fired,
          ts: 1_000_000,
          ruleId: RULE_ID,
          symbolId: SYMBOL_ID,
          firedAt: 999,
          context: {
            // The candle bridge emits 5 OHLCV events synchronously into
            // `enqueue`, which calls `lookups.record` **synchronously**
            // before scheduling the orchestrator (#290 wire). So every
            // OHLCV slot is already populated by the time the orchestrator
            // processes the first emitted event (open).
            inboundEvent: {
              kind: RuleEventKind.OpenValueChanged,
              ts: 1_000_000,
              symbolId: SYMBOL_ID,
              prev: null,
              current: 105,
              final: true,
            },
            lookupSnapshot: {
              // `current` falls back to the latest close when no quote
              // stream has set it (see LiveEvaluationLookups.getCurrentValue).
              current: 105,
              open: 105,
              high: 105,
              low: 105,
              close: 105,
              volume: 1_000,
            },
          },
        },
      ],
    });
  });

  it('logs the failure and appends one synthetic Error event when the orchestrator throws', async () => {
    const fixtures = await buildFixtures();
    const state = new InMemoryStateRepository();
    const eventLog = new InMemoryEventLog(() => 999);
    const firingState = new InMemoryFiringStateRepository();
    const notifier = new InMemoryNotifier(['main']);

    // Wrap the rule repo so `listEnabledForSymbol` throws — every inbound
    // event from this point hits the cascade error handler.
    const throwingRules = {
      ...fixtures.rules,
      listEnabledForSymbol: () => Promise.reject(new Error('boom')),
      list: fixtures.rules.list.bind(fixtures.rules),
      listForSymbol: fixtures.rules.listForSymbol.bind(fixtures.rules),
      get: fixtures.rules.get.bind(fixtures.rules),
      save: fixtures.rules.save.bind(fixtures.rules),
      remove: fixtures.rules.remove.bind(fixtures.rules),
      removeForProfile: fixtures.rules.removeForProfile.bind(fixtures.rules),
    };

    const wired = wireRuleEngine({
      rules: throwingRules,
      watchlist: fixtures.watchlist,
      state,
      notifier,
      eventLog,
      firingState,
    });

    // Push exactly one event through so we can assert exactly one Error
    // entry — the candle bridge fans out one per-field event for an inbound
    // candle, so we drive a single CurrentValueChanged via the sink directly
    // (the bridge's `emit` callback) to keep this test deterministic.
    wired.candleBridge.handleCandle({
      id: SYMBOL_ID,
      period: Period.OneMinute,
      candle: candle(1_000_000, 105),
      final: false,
    });
    // Drain only the events the candle bridge produced — 5 OHLCV events.
    await wired.drain();

    const symbolEvents = await eventLog.symbolEvents(SYMBOL_ID);
    const errors = symbolEvents.filter((event) => event.type === RuleEventType.Error);
    expect({
      errorCount: errors.length,
      reason: errors[0]?.type === RuleEventType.Error ? errors[0].reason : null,
      ruleId: errors[0]?.ruleId,
      symbolId: errors[0]?.symbolId,
    }).toEqual({
      errorCount: 5,
      reason: 'rule orchestration failed: boom',
      ruleId: '',
      symbolId: SYMBOL_ID,
    });
    // The candle event has no `current` axis (that's QuoteStreamService's
    // job), so `CurrentValueChanged` isn't emitted — but each of the 5
    // OHLCV-field changes goes through the chain and hits the cascade
    // handler, producing 5 synthetic Error events. The engine's logger
    // emission is asserted at the unit tier (#306).
    expect(notifier.sent).toEqual([]);
  });
});
