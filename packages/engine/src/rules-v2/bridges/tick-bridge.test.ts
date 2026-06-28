import { Period, RulesV2, type SymbolQuoteEvent } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { TickBridge } from './tick-bridge.js';

/** Build a complete `SymbolQuoteEvent` from a few overrides. */
function quoteEvent(overrides: {
  id?: string;
  period?: Period;
  price: number;
  time: number;
  final?: boolean;
  change?: number;
  changePct?: number;
  subscriptionId?: string;
}): SymbolQuoteEvent {
  return {
    subscriptionId: overrides.subscriptionId ?? 'sub-1',
    id: overrides.id ?? 'BTC',
    period: overrides.period ?? Period.OneMinute,
    quote: {
      price: overrides.price,
      change: overrides.change ?? 0,
      changePct: overrides.changePct ?? 0,
      time: overrides.time,
    },
    final: overrides.final ?? false,
  };
}

describe('TickBridge', () => {
  it('emits exactly one TickEvent with ts/symbolId/price taken from the inbound SymbolQuoteEvent', () => {
    const events: RulesV2.EvaluationTriggerEvent[] = [];
    const bridge = new TickBridge((event) => events.push(event));
    bridge.handleQuote(quoteEvent({ id: 'BTC', price: 12_345.67, time: 1_000 }));
    expect(events).toEqual([
      {
        kind: RulesV2.EvaluationTriggerKind.Tick,
        ts: 1_000,
        symbolId: 'BTC',
        price: 12_345.67,
      },
    ]);
  });

  it('ignores the inbound `final` flag — both forming and closed quotes produce a TickEvent of the same shape', () => {
    const events: RulesV2.EvaluationTriggerEvent[] = [];
    const bridge = new TickBridge((event) => events.push(event));
    bridge.handleQuote(quoteEvent({ id: 'BTC', price: 100, time: 1_000, final: false }));
    bridge.handleQuote(quoteEvent({ id: 'BTC', price: 100, time: 1_000, final: true }));
    expect(events).toEqual([
      { kind: RulesV2.EvaluationTriggerKind.Tick, ts: 1_000, symbolId: 'BTC', price: 100 },
      { kind: RulesV2.EvaluationTriggerKind.Tick, ts: 1_000, symbolId: 'BTC', price: 100 },
    ]);
  });
});
