import { Period, type RuleEvent, RuleEventKind, type SymbolQuoteEvent } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { QuoteRuleEventBridge } from './quote-rule-event-bridge.js';

/** Build a complete `SymbolQuoteEvent` from a few overrides. */
function quoteEvent(overrides: {
  id: string;
  price: number;
  time: number;
  period?: Period;
}): SymbolQuoteEvent {
  return {
    subscriptionId: 'sub-1',
    id: overrides.id,
    period: overrides.period ?? Period.OneMinute,
    quote: {
      price: overrides.price,
      change: 0,
      changePct: 0,
      time: overrides.time,
    },
    final: false,
  };
}

describe('QuoteRuleEventBridge', () => {
  it('emits one CurrentValueChanged event with prev=null on the first quote for a symbol', () => {
    const events: RuleEvent[] = [];
    const bridge = new QuoteRuleEventBridge((event) => events.push(event));
    bridge.handleQuote(quoteEvent({ id: 'AAPL', price: 100, time: 1000 }));
    expect(events).toEqual([
      {
        kind: RuleEventKind.CurrentValueChanged,
        ts: 1000,
        symbolId: 'AAPL',
        prev: null,
        current: 100,
      },
    ]);
  });

  it('emits prev=previous price on subsequent quotes for the same symbol', () => {
    const events: RuleEvent[] = [];
    const bridge = new QuoteRuleEventBridge((event) => events.push(event));
    bridge.handleQuote(quoteEvent({ id: 'AAPL', price: 100, time: 1000 }));
    bridge.handleQuote(quoteEvent({ id: 'AAPL', price: 101, time: 2000 }));
    expect(events).toEqual([
      {
        kind: RuleEventKind.CurrentValueChanged,
        ts: 1000,
        symbolId: 'AAPL',
        prev: null,
        current: 100,
      },
      {
        kind: RuleEventKind.CurrentValueChanged,
        ts: 2000,
        symbolId: 'AAPL',
        prev: 100,
        current: 101,
      },
    ]);
  });

  it('keeps prev/current state isolated between symbols', () => {
    const events: RuleEvent[] = [];
    const bridge = new QuoteRuleEventBridge((event) => events.push(event));
    bridge.handleQuote(quoteEvent({ id: 'AAPL', price: 100, time: 1000 }));
    bridge.handleQuote(quoteEvent({ id: 'MSFT', price: 200, time: 1100 }));
    expect(events).toEqual([
      {
        kind: RuleEventKind.CurrentValueChanged,
        ts: 1000,
        symbolId: 'AAPL',
        prev: null,
        current: 100,
      },
      {
        kind: RuleEventKind.CurrentValueChanged,
        ts: 1100,
        symbolId: 'MSFT',
        prev: null,
        current: 200,
      },
    ]);
  });
});
