import {
  type EquityCandle,
  type FxCandle,
  Period,
  type RuleEvent,
  RuleEventKind,
  SymbolType,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import type { CandleEvent } from '../candles/polling-service.types.js';
import { CandleRuleEventBridge } from './candle-rule-event-bridge.js';

/** Build a complete equity-candle `CandleEvent` from a few overrides. */
function equityCandleEvent(overrides: {
  id?: string;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  final?: boolean;
  period?: Period;
}): CandleEvent {
  const candle: EquityCandle = {
    type: SymbolType.Stock,
    time: overrides.time,
    open: overrides.open,
    high: overrides.high,
    low: overrides.low,
    close: overrides.close,
    volume: overrides.volume,
  };
  return {
    id: overrides.id ?? 'AAPL',
    period: overrides.period ?? Period.OneMinute,
    candle,
    final: overrides.final ?? false,
  };
}

/** Build a complete FX `CandleEvent` (no volume). */
function fxCandleEvent(overrides: {
  id?: string;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  final?: boolean;
  period?: Period;
}): CandleEvent {
  const candle: FxCandle = {
    type: SymbolType.Fx,
    time: overrides.time,
    open: overrides.open,
    high: overrides.high,
    low: overrides.low,
    close: overrides.close,
  };
  return {
    id: overrides.id ?? 'EURUSD',
    period: overrides.period ?? Period.OneMinute,
    candle,
    final: overrides.final ?? false,
  };
}

describe('CandleRuleEventBridge', () => {
  it('emits one event per OHLCV field on the first observation of a candle', () => {
    const events: RuleEvent[] = [];
    const bridge = new CandleRuleEventBridge((event) => events.push(event));
    bridge.handleCandle(
      equityCandleEvent({ time: 1000, open: 100, high: 105, low: 99, close: 102, volume: 1000 }),
    );
    expect(events).toEqual([
      {
        kind: RuleEventKind.OpenValueChanged,
        ts: 1000,
        symbolId: 'AAPL',
        prev: null,
        current: 100,
        final: false,
      },
      {
        kind: RuleEventKind.HighValueChanged,
        ts: 1000,
        symbolId: 'AAPL',
        prev: null,
        current: 105,
        final: false,
      },
      {
        kind: RuleEventKind.LowValueChanged,
        ts: 1000,
        symbolId: 'AAPL',
        prev: null,
        current: 99,
        final: false,
      },
      {
        kind: RuleEventKind.CloseValueChanged,
        ts: 1000,
        symbolId: 'AAPL',
        prev: null,
        current: 102,
        final: false,
      },
      {
        kind: RuleEventKind.VolumeValueChanged,
        ts: 1000,
        symbolId: 'AAPL',
        prev: null,
        current: 1000,
        final: false,
      },
    ]);
  });

  it('emits only the fields that changed against prev on a re-poll of the same forming bar', () => {
    const events: RuleEvent[] = [];
    const bridge = new CandleRuleEventBridge((event) => events.push(event));
    bridge.handleCandle(
      equityCandleEvent({ time: 1000, open: 100, high: 105, low: 99, close: 102, volume: 1000 }),
    );
    events.length = 0;
    bridge.handleCandle(
      equityCandleEvent({ time: 1000, open: 100, high: 105, low: 99, close: 103, volume: 1500 }),
    );
    expect(events).toEqual([
      {
        kind: RuleEventKind.CloseValueChanged,
        ts: 1000,
        symbolId: 'AAPL',
        prev: 102,
        current: 103,
        final: false,
      },
      {
        kind: RuleEventKind.VolumeValueChanged,
        ts: 1000,
        symbolId: 'AAPL',
        prev: 1000,
        current: 1500,
        final: false,
      },
    ]);
  });

  it('preserves final=true on every event when the inbound bar is final', () => {
    const events: RuleEvent[] = [];
    const bridge = new CandleRuleEventBridge((event) => events.push(event));
    bridge.handleCandle(
      equityCandleEvent({
        time: 1000,
        open: 100,
        high: 105,
        low: 99,
        close: 103,
        volume: 1500,
        final: true,
      }),
    );
    expect(events.map((event) => ('final' in event ? event.final : undefined))).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it('skips the VolumeValueChanged event for FX candles', () => {
    const events: RuleEvent[] = [];
    const bridge = new CandleRuleEventBridge((event) => events.push(event));
    bridge.handleCandle(fxCandleEvent({ time: 1000, open: 1.1, high: 1.2, low: 1.0, close: 1.15 }));
    expect(events.map((event) => event.kind)).toEqual([
      RuleEventKind.OpenValueChanged,
      RuleEventKind.HighValueChanged,
      RuleEventKind.LowValueChanged,
      RuleEventKind.CloseValueChanged,
    ]);
  });

  it('keeps prev/current state isolated between symbols', () => {
    const events: RuleEvent[] = [];
    const bridge = new CandleRuleEventBridge((event) => events.push(event));
    bridge.handleCandle(
      equityCandleEvent({
        id: 'AAPL',
        time: 1000,
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: 1000,
      }),
    );
    events.length = 0;
    bridge.handleCandle(
      equityCandleEvent({
        id: 'MSFT',
        time: 1000,
        open: 200,
        high: 205,
        low: 199,
        close: 202,
        volume: 5000,
      }),
    );
    expect(events.every((event) => 'prev' in event && event.prev === null)).toBe(true);
  });
});
