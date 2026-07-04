import type { CandleEvent } from '@lametrader/core';
import { type EvaluationTriggerEvent, EvaluationTriggerKind, Period } from '@lametrader/core';
import { BarLifecycleBridge } from './bar-lifecycle-bridge.js';

/**
 * Build a minimal {@link CandleEvent} for a polled candle.
 */
function pollCandle(overrides: {
  id: string;
  period?: Period;
  time: number;
  close?: number;
  final?: boolean;
}): CandleEvent {
  return {
    id: overrides.id,
    period: overrides.period ?? Period.OneMinute,
    candle: {
      open: overrides.close ?? 100,
      high: overrides.close ?? 100,
      low: overrides.close ?? 100,
      close: overrides.close ?? 100,
      volume: 1,
      time: overrides.time,
    },
    final: overrides.final ?? false,
  };
}

/**
 * Locked design pillar (ADR 0016): ticks come from the live
 * {@link QuoteStreamService} only — no synthesized ticks.
 *
 * A polled-only symbol — one whose only upstream feed is the
 * {@link PollingService} candle stream wired into {@link BarLifecycleBridge} —
 * must surface `BarOpened` / `BarClosed` events and never a `TickEvent`.
 * If a regression started bridging polled candle closes back into tick events
 * (re-creating the original #381 axis-mixing trap) this test catches it.
 */
describe('polled-only symbol (BarLifecycleBridge only, no TickBridge upstream)', () => {
  it('emits BarOpened/BarClosed for a polled symbol and never a TickEvent', () => {
    const emitted: EvaluationTriggerEvent[] = [];
    const barBridge = new BarLifecycleBridge((event) => emitted.push(event));

    // A polled candle advances ts (BarOpened).
    barBridge.handleCandle(pollCandle({ id: 'MSFT', time: 1_000_000, close: 200 }));
    // Same bar, same ts, final = true (BarClosed).
    barBridge.handleCandle(pollCandle({ id: 'MSFT', time: 1_000_000, close: 201, final: true }));
    // Next bar, advanced ts (BarOpened).
    barBridge.handleCandle(pollCandle({ id: 'MSFT', time: 1_060_000, close: 202 }));

    expect(emitted).toEqual([
      {
        kind: EvaluationTriggerKind.BarOpened,
        ts: 1_000_000,
        symbolId: 'MSFT',
        period: Period.OneMinute,
      },
      {
        kind: EvaluationTriggerKind.BarClosed,
        ts: 1_000_000,
        symbolId: 'MSFT',
        period: Period.OneMinute,
      },
      {
        kind: EvaluationTriggerKind.BarOpened,
        ts: 1_060_000,
        symbolId: 'MSFT',
        period: Period.OneMinute,
      },
    ]);
    const ticks = emitted.filter((e) => e.kind === EvaluationTriggerKind.Tick);
    expect(ticks).toEqual([]);
  });
});
