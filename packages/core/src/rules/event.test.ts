import { describe, expect, it } from 'vitest';

import { Period } from '../config.types.js';
import { StateValueType } from '../state.types.js';
import {
  type DataUpdateEvent,
  DataUpdateKind,
  type EvaluationTriggerEvent,
  EvaluationTriggerKind,
} from './event.types.js';

describe('EvaluationTriggerEvent', () => {
  it('admits a Tick variant carrying ts/symbolId/price', () => {
    const e: EvaluationTriggerEvent = {
      kind: EvaluationTriggerKind.Tick,
      ts: 1_700_000_000_000,
      symbolId: 'BTC',
      price: 50_000,
    };
    expect(e).toEqual({
      kind: EvaluationTriggerKind.Tick,
      ts: 1_700_000_000_000,
      symbolId: 'BTC',
      price: 50_000,
    });
  });

  it('admits a BarOpened variant carrying symbolId/period/ts', () => {
    const e: EvaluationTriggerEvent = {
      kind: EvaluationTriggerKind.BarOpened,
      ts: 1_700_000_060_000,
      symbolId: 'BTC',
      period: Period.OneMinute,
    };
    expect(e).toEqual({
      kind: EvaluationTriggerKind.BarOpened,
      ts: 1_700_000_060_000,
      symbolId: 'BTC',
      period: Period.OneMinute,
    });
  });

  it('admits a BarClosed variant carrying symbolId/period/ts', () => {
    const e: EvaluationTriggerEvent = {
      kind: EvaluationTriggerKind.BarClosed,
      ts: 1_700_000_120_000,
      symbolId: 'BTC',
      period: Period.OneMinute,
    };
    expect(e).toEqual({
      kind: EvaluationTriggerKind.BarClosed,
      ts: 1_700_000_120_000,
      symbolId: 'BTC',
      period: Period.OneMinute,
    });
  });

  it('admits a Timer variant carrying ts (no symbolId)', () => {
    const e: EvaluationTriggerEvent = {
      kind: EvaluationTriggerKind.Timer,
      ts: 1_700_000_000_000,
    };
    expect(e).toEqual({ kind: EvaluationTriggerKind.Timer, ts: 1_700_000_000_000 });
  });

  it('admits a SymbolStateChanged cascade trigger', () => {
    const e: EvaluationTriggerEvent = {
      kind: EvaluationTriggerKind.SymbolStateChanged,
      ts: 1,
      symbolId: 'BTC',
      profileId: 'p1',
      key: 'trend',
      prev: null,
      current: { type: StateValueType.String, value: 'up' },
    };
    expect(e).toEqual({
      kind: EvaluationTriggerKind.SymbolStateChanged,
      ts: 1,
      symbolId: 'BTC',
      profileId: 'p1',
      key: 'trend',
      prev: null,
      current: { type: StateValueType.String, value: 'up' },
    });
  });

  it('admits a GlobalStateChanged cascade trigger', () => {
    const e: EvaluationTriggerEvent = {
      kind: EvaluationTriggerKind.GlobalStateChanged,
      ts: 1,
      profileId: 'p1',
      key: 'mode',
      prev: { type: StateValueType.String, value: 'off' },
      current: { type: StateValueType.String, value: 'on' },
    };
    expect(e).toEqual({
      kind: EvaluationTriggerKind.GlobalStateChanged,
      ts: 1,
      profileId: 'p1',
      key: 'mode',
      prev: { type: StateValueType.String, value: 'off' },
      current: { type: StateValueType.String, value: 'on' },
    });
  });

  it('admits an IndicatorChanged cascade trigger carrying profileId', () => {
    const e: EvaluationTriggerEvent = {
      kind: EvaluationTriggerKind.IndicatorChanged,
      ts: 1,
      symbolId: 'BTC',
      profileId: 'p1',
      instanceId: 'i1',
      stateKey: 'value',
      prev: null,
      current: { type: StateValueType.Number, value: 42 },
    };
    expect(e).toEqual({
      kind: EvaluationTriggerKind.IndicatorChanged,
      ts: 1,
      symbolId: 'BTC',
      profileId: 'p1',
      instanceId: 'i1',
      stateKey: 'value',
      prev: null,
      current: { type: StateValueType.Number, value: 42 },
    });
  });
});

describe('DataUpdateEvent', () => {
  it('admits per-axis OHLCV variants (Open, High, Low, Close, Volume)', () => {
    const events: DataUpdateEvent[] = [
      { kind: DataUpdateKind.Open, ts: 1, symbolId: 'BTC', period: Period.OneMinute, value: 10 },
      { kind: DataUpdateKind.High, ts: 1, symbolId: 'BTC', period: Period.OneMinute, value: 12 },
      { kind: DataUpdateKind.Low, ts: 1, symbolId: 'BTC', period: Period.OneMinute, value: 9 },
      { kind: DataUpdateKind.Close, ts: 1, symbolId: 'BTC', period: Period.OneMinute, value: 11 },
      { kind: DataUpdateKind.Volume, ts: 1, symbolId: 'BTC', period: Period.OneMinute, value: 100 },
    ];
    expect(events).toEqual([
      { kind: DataUpdateKind.Open, ts: 1, symbolId: 'BTC', period: Period.OneMinute, value: 10 },
      { kind: DataUpdateKind.High, ts: 1, symbolId: 'BTC', period: Period.OneMinute, value: 12 },
      { kind: DataUpdateKind.Low, ts: 1, symbolId: 'BTC', period: Period.OneMinute, value: 9 },
      { kind: DataUpdateKind.Close, ts: 1, symbolId: 'BTC', period: Period.OneMinute, value: 11 },
      { kind: DataUpdateKind.Volume, ts: 1, symbolId: 'BTC', period: Period.OneMinute, value: 100 },
    ]);
  });
});
