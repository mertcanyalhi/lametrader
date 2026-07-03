import {
  type EvaluationTriggerEvent,
  EvaluationTriggerKind,
  Period,
  type SymbolQuoteEvent,
} from '@lametrader/core';
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
    const events: EvaluationTriggerEvent[] = [];
    const bridge = new TickBridge((event) => events.push(event));
    bridge.handleQuote(quoteEvent({ id: 'BTC', price: 12_345.67, time: 1_000 }));
    expect(events).toEqual([
      {
        kind: EvaluationTriggerKind.Tick,
        ts: 1_000,
        symbolId: 'BTC',
        price: 12_345.67,
      },
    ]);
  });

  it('ignores the inbound `final` flag — a forming then a closed quote at different prices each produce a TickEvent carrying no `final`', () => {
    const events: EvaluationTriggerEvent[] = [];
    const bridge = new TickBridge((event) => events.push(event));
    bridge.handleQuote(quoteEvent({ id: 'BTC', price: 100, time: 1_000, final: false }));
    bridge.handleQuote(quoteEvent({ id: 'BTC', price: 101, time: 2_000, final: true }));
    expect(events).toEqual([
      { kind: EvaluationTriggerKind.Tick, ts: 1_000, symbolId: 'BTC', price: 100 },
      { kind: EvaluationTriggerKind.Tick, ts: 2_000, symbolId: 'BTC', price: 101 },
    ]);
  });

  it('emits nothing on a second quote whose price equals the last emitted price for the same (symbolId, period)', () => {
    const events: EvaluationTriggerEvent[] = [];
    const bridge = new TickBridge((event) => events.push(event));
    bridge.handleQuote(quoteEvent({ id: 'BTC', price: 100, time: 1_000 }));
    bridge.handleQuote(quoteEvent({ id: 'BTC', price: 100, time: 2_000 }));
    expect(events).toEqual([
      { kind: EvaluationTriggerKind.Tick, ts: 1_000, symbolId: 'BTC', price: 100 },
    ]);
  });

  it('emits again once the price differs from the last emitted price for that (symbolId, period)', () => {
    const events: EvaluationTriggerEvent[] = [];
    const bridge = new TickBridge((event) => events.push(event));
    bridge.handleQuote(quoteEvent({ id: 'BTC', price: 100, time: 1_000 }));
    bridge.handleQuote(quoteEvent({ id: 'BTC', price: 100, time: 2_000 }));
    bridge.handleQuote(quoteEvent({ id: 'BTC', price: 101, time: 3_000 }));
    expect(events).toEqual([
      { kind: EvaluationTriggerKind.Tick, ts: 1_000, symbolId: 'BTC', price: 100 },
      { kind: EvaluationTriggerKind.Tick, ts: 3_000, symbolId: 'BTC', price: 101 },
    ]);
  });

  it('keeps its last-price cache isolated per symbol — a flat price on one symbol does not silence a moving price on another', () => {
    const events: EvaluationTriggerEvent[] = [];
    const bridge = new TickBridge((event) => events.push(event));
    bridge.handleQuote(quoteEvent({ id: 'AAPL', price: 100, time: 1_000 }));
    bridge.handleQuote(quoteEvent({ id: 'MSFT', price: 100, time: 1_000 }));
    bridge.handleQuote(quoteEvent({ id: 'AAPL', price: 100, time: 2_000 }));
    bridge.handleQuote(quoteEvent({ id: 'MSFT', price: 200, time: 2_000 }));
    expect(events).toEqual([
      { kind: EvaluationTriggerKind.Tick, ts: 1_000, symbolId: 'AAPL', price: 100 },
      { kind: EvaluationTriggerKind.Tick, ts: 1_000, symbolId: 'MSFT', price: 100 },
      { kind: EvaluationTriggerKind.Tick, ts: 2_000, symbolId: 'MSFT', price: 200 },
    ]);
  });

  it('keeps its last-price cache isolated per period — the same flat price on two periods of one symbol each emits once', () => {
    const events: EvaluationTriggerEvent[] = [];
    const bridge = new TickBridge((event) => events.push(event));
    bridge.handleQuote(
      quoteEvent({ id: 'BTC', period: Period.OneMinute, price: 100, time: 1_000 }),
    );
    bridge.handleQuote(
      quoteEvent({ id: 'BTC', period: Period.FiveMinutes, price: 100, time: 1_000 }),
    );
    expect(events).toEqual([
      { kind: EvaluationTriggerKind.Tick, ts: 1_000, symbolId: 'BTC', price: 100 },
      { kind: EvaluationTriggerKind.Tick, ts: 1_000, symbolId: 'BTC', price: 100 },
    ]);
  });
});
