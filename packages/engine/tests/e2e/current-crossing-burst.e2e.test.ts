import {
  ActionKind,
  ConditionNodeKind,
  NumericOperator,
  OperandKind,
  Period,
  type Rule,
  RuleEventType,
  RuleScopeKind,
  StateValueType,
  type SymbolQuoteEvent,
  type SymbolType,
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
 * E2e for #381 — `Current crossing X` against a literal threshold under a
 * burst of live quote ticks driven through {@link wireRuleEngine}'s real
 * `quoteBridge`. Drives both the prev/current cache rotation timing and the
 * cross-axis fallback drop end-to-end.
 */

const SYMBOL_ID = 'crypto:ETHBTC';
const PROFILE_ID = 'profile-1';
const RULE_ID = 'cross-up-threshold';
const THRESHOLD = 0.02622;

/** Build the canonical `Current crossing THRESHOLD` rule for AAPL. */
function crossingRule(): Rule {
  return {
    id: RULE_ID,
    profileId: PROFILE_ID,
    name: 'cross up',
    scope: { kind: RuleScopeKind.Symbol, symbolId: SYMBOL_ID },
    condition: {
      kind: ConditionNodeKind.Leaf,
      left: { kind: OperandKind.CurrentValue, valueType: StateValueType.Number },
      operator: NumericOperator.Crossing,
      right: {
        kind: OperandKind.Literal,
        value: { type: StateValueType.Number, value: THRESHOLD },
      },
    },
    trigger: { kind: TriggerKind.Once },
    expiration: null,
    actions: [{ kind: ActionKind.NotifyTelegram, destinationName: 'main', template: 'cross' }],
    enabled: true,
    order: 1,
    events: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

/** Build a `SymbolQuoteEvent` for the watched symbol on the 1m period. */
function quote(price: number, time: number): SymbolQuoteEvent {
  return {
    subscriptionId: 'sub-1',
    id: SYMBOL_ID,
    period: Period.OneMinute,
    quote: { price, change: 0, changePct: 0, time },
    final: false,
  };
}

/** Build a `CandleEvent`-shaped payload for the watched symbol. */
function candleEvent(
  close: number,
  time: number,
): { id: string; period: Period; candle: Record<string, unknown>; final: boolean } {
  return {
    id: SYMBOL_ID,
    period: Period.OneMinute,
    candle: {
      type: 'crypto' as SymbolType,
      open: close,
      high: close,
      low: close,
      close,
      volume: 1,
      time,
    },
    final: false,
  };
}

/** Stand up `wireRuleEngine` against in-memory adapters; return chain + log. */
function buildChain() {
  const rules = new InMemoryRuleRepository([crossingRule()]);
  const eventLog = new InMemoryEventLog(() => 999);
  const wired = wireRuleEngine({
    rules,
    watchlist: new InMemoryWatchlistRepository(),
    state: new InMemoryStateRepository(),
    notifier: new InMemoryNotifier(['main']),
    eventLog,
    firingState: new InMemoryFiringStateRepository(),
  });
  return { wired, eventLog };
}

describe('current-crossing-burst (e2e)', () => {
  it('fires `Current crossing 0.02622` exactly once on the burst tick that genuinely transits the threshold upward (#381 happy path)', async () => {
    const { wired, eventLog } = buildChain();

    // Burst: three same-symbol quote ticks delivered back-to-back. The
    // first two land below the threshold; the third lands above. Only the
    // third tick is a genuine upward crossing, so the rule must fire once
    // with `inboundEvent.ts === 3`.
    wired.quoteBridge.handleQuote(quote(0.0262, 1));
    wired.quoteBridge.handleQuote(quote(0.02621, 2));
    wired.quoteBridge.handleQuote(quote(0.02623, 3));
    await wired.drain();

    const fired = (await eventLog.symbolEvents(SYMBOL_ID)).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    expect({
      count: fired.length,
      firedOnTs: fired[0]?.type === RuleEventType.Fired ? fired[0].context?.inboundEvent.ts : null,
    }).toEqual({ count: 1, firedOnTs: 3 });
  });

  it('does not fire the Current-crossing rule on the first quote when a polled close above the threshold pre-populated the close-axis prev (#381 critical failure mode)', async () => {
    const { wired, eventLog } = buildChain();

    // Polled closes above the threshold prime `prevCloseValues`. Before
    // the fix, `getPrevCurrentValue` fell back to that close-axis prev,
    // so the very first quote tick at 0.0262 (below) was read as a
    // downward crossing through 0.02622 against a prev of 0.0265 — the
    // rule fired on the wrong event. After the fix, the first quote's
    // prev is `null` (no quote-axis prev yet) and the rule cannot fire
    // until a real quote-axis pair crosses the threshold upward.
    wired.candleBridge.handleCandle(
      candleEvent(0.0265, 1) as Parameters<typeof wired.candleBridge.handleCandle>[0],
    );
    wired.candleBridge.handleCandle(
      candleEvent(0.0266, 2) as Parameters<typeof wired.candleBridge.handleCandle>[0],
    );
    wired.quoteBridge.handleQuote(quote(0.0262, 3));
    wired.quoteBridge.handleQuote(quote(0.02623, 4));
    await wired.drain();

    const fired = (await eventLog.symbolEvents(SYMBOL_ID)).filter(
      (event) => event.type === RuleEventType.Fired,
    );
    expect({
      count: fired.length,
      firedOnTs: fired[0]?.type === RuleEventType.Fired ? fired[0].context?.inboundEvent.ts : null,
    }).toEqual({ count: 1, firedOnTs: 4 });
  });
});
