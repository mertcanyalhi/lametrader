import {
  type EquityCandle,
  type EvaluationTriggerEvent,
  EvaluationTriggerKind,
  Period,
  SymbolType,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import type { CandleEvent } from '../../candles/polling-service.types.js';
import { BarLifecycleBridge } from './bar-lifecycle-bridge.js';

/** Build a complete equity-candle `CandleEvent` from a few overrides. */
function candleEvent(overrides: {
  id?: string;
  period?: Period;
  time: number;
  final?: boolean;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
}): CandleEvent {
  const candle: EquityCandle = {
    type: SymbolType.Stock,
    time: overrides.time,
    open: overrides.open ?? 100,
    high: overrides.high ?? 105,
    low: overrides.low ?? 99,
    close: overrides.close ?? 102,
    volume: overrides.volume ?? 1_000,
  };
  return {
    id: overrides.id ?? 'AAPL',
    period: overrides.period ?? Period.OneMinute,
    candle,
    final: overrides.final ?? false,
  };
}

describe('BarLifecycleBridge', () => {
  it('emits BarOpened on the first observation of a (symbolId, period) pair', () => {
    const events: EvaluationTriggerEvent[] = [];
    const bridge = new BarLifecycleBridge((event) => events.push(event));
    bridge.handleCandle(candleEvent({ id: 'AAPL', period: Period.OneMinute, time: 60_000 }));
    expect(events).toEqual([
      {
        kind: EvaluationTriggerKind.BarOpened,
        ts: 60_000,
        symbolId: 'AAPL',
        period: Period.OneMinute,
      },
    ]);
  });

  it('emits BarOpened on every advancement of candle.time for the same (symbolId, period)', () => {
    const events: EvaluationTriggerEvent[] = [];
    const bridge = new BarLifecycleBridge((event) => events.push(event));
    bridge.handleCandle(candleEvent({ id: 'AAPL', period: Period.OneMinute, time: 60_000 }));
    bridge.handleCandle(candleEvent({ id: 'AAPL', period: Period.OneMinute, time: 120_000 }));
    bridge.handleCandle(candleEvent({ id: 'AAPL', period: Period.OneMinute, time: 180_000 }));
    expect(events).toEqual([
      {
        kind: EvaluationTriggerKind.BarOpened,
        ts: 60_000,
        symbolId: 'AAPL',
        period: Period.OneMinute,
      },
      {
        kind: EvaluationTriggerKind.BarOpened,
        ts: 120_000,
        symbolId: 'AAPL',
        period: Period.OneMinute,
      },
      {
        kind: EvaluationTriggerKind.BarOpened,
        ts: 180_000,
        symbolId: 'AAPL',
        period: Period.OneMinute,
      },
    ]);
  });

  it('emits nothing on a re-poll of the same forming bar (same candle.time, final = false, no close yet)', () => {
    const events: EvaluationTriggerEvent[] = [];
    const bridge = new BarLifecycleBridge((event) => events.push(event));
    bridge.handleCandle(
      candleEvent({ id: 'AAPL', period: Period.OneMinute, time: 60_000, final: false }),
    );
    events.length = 0;
    bridge.handleCandle(
      candleEvent({
        id: 'AAPL',
        period: Period.OneMinute,
        time: 60_000,
        final: false,
        close: 103,
      }),
    );
    bridge.handleCandle(
      candleEvent({
        id: 'AAPL',
        period: Period.OneMinute,
        time: 60_000,
        final: false,
        close: 104,
      }),
    );
    expect(events).toEqual([]);
  });

  it('emits BarClosed on the first final=true observation for a (symbolId, period, ts) and dedupes subsequent final observations on the same ts', () => {
    const events: EvaluationTriggerEvent[] = [];
    const bridge = new BarLifecycleBridge((event) => events.push(event));
    bridge.handleCandle(
      candleEvent({ id: 'AAPL', period: Period.OneMinute, time: 60_000, final: false }),
    );
    events.length = 0;
    bridge.handleCandle(
      candleEvent({ id: 'AAPL', period: Period.OneMinute, time: 60_000, final: true }),
    );
    bridge.handleCandle(
      candleEvent({ id: 'AAPL', period: Period.OneMinute, time: 60_000, final: true }),
    );
    expect(events).toEqual([
      {
        kind: EvaluationTriggerKind.BarClosed,
        ts: 60_000,
        symbolId: 'AAPL',
        period: Period.OneMinute,
      },
    ]);
  });

  it('emits BarOpened followed by BarClosed when a single inbound candle both advances ts and arrives as final=true (e.g. a backfilled closed candle)', () => {
    const events: EvaluationTriggerEvent[] = [];
    const bridge = new BarLifecycleBridge((event) => events.push(event));
    bridge.handleCandle(
      candleEvent({ id: 'AAPL', period: Period.OneMinute, time: 60_000, final: true }),
    );
    expect(events).toEqual([
      {
        kind: EvaluationTriggerKind.BarOpened,
        ts: 60_000,
        symbolId: 'AAPL',
        period: Period.OneMinute,
      },
      {
        kind: EvaluationTriggerKind.BarClosed,
        ts: 60_000,
        symbolId: 'AAPL',
        period: Period.OneMinute,
      },
    ]);
  });

  it('keeps lifecycle state isolated per (symbolId, period) — one pair does not silence another', () => {
    const events: EvaluationTriggerEvent[] = [];
    const bridge = new BarLifecycleBridge((event) => events.push(event));
    bridge.handleCandle(candleEvent({ id: 'AAPL', period: Period.OneMinute, time: 60_000 }));
    bridge.handleCandle(candleEvent({ id: 'MSFT', period: Period.OneMinute, time: 60_000 }));
    bridge.handleCandle(candleEvent({ id: 'AAPL', period: Period.FiveMinutes, time: 60_000 }));
    expect(events).toEqual([
      {
        kind: EvaluationTriggerKind.BarOpened,
        ts: 60_000,
        symbolId: 'AAPL',
        period: Period.OneMinute,
      },
      {
        kind: EvaluationTriggerKind.BarOpened,
        ts: 60_000,
        symbolId: 'MSFT',
        period: Period.OneMinute,
      },
      {
        kind: EvaluationTriggerKind.BarOpened,
        ts: 60_000,
        symbolId: 'AAPL',
        period: Period.FiveMinutes,
      },
    ]);
  });
});
