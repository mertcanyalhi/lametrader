import { describe, expect, it } from 'vitest';

import {
  type CloseValueChangedEvent,
  type CurrentValueChangedEvent,
  type GlobalStateChangedEvent,
  type HighValueChangedEvent,
  type IndicatorValueChangedEvent,
  type LowValueChangedEvent,
  type OpenValueChangedEvent,
  RuleEventKind,
  type SymbolStateChangedEvent,
  type TimerEvent,
  type VolumeValueChangedEvent,
} from './rule-event.types.js';
import { StateValueType } from './state.types.js';

describe('RuleEvent variants', () => {
  it('constructs a TimerEvent', () => {
    const event: TimerEvent = { kind: RuleEventKind.Timer, ts: 100, symbolId: null };
    expect(event).toEqual({ kind: RuleEventKind.Timer, ts: 100, symbolId: null });
  });

  it('constructs a CurrentValueChangedEvent', () => {
    const event: CurrentValueChangedEvent = {
      kind: RuleEventKind.CurrentValueChanged,
      ts: 100,
      symbolId: 'AAPL',
      prev: 99,
      current: 100,
    };
    expect(event).toEqual({
      kind: RuleEventKind.CurrentValueChanged,
      ts: 100,
      symbolId: 'AAPL',
      prev: 99,
      current: 100,
    });
  });

  it('constructs an OpenValueChangedEvent', () => {
    const event: OpenValueChangedEvent = {
      kind: RuleEventKind.OpenValueChanged,
      ts: 100,
      symbolId: 'AAPL',
      prev: null,
      current: 100,
    };
    expect(event).toEqual({
      kind: RuleEventKind.OpenValueChanged,
      ts: 100,
      symbolId: 'AAPL',
      prev: null,
      current: 100,
    });
  });

  it('constructs a HighValueChangedEvent', () => {
    const event: HighValueChangedEvent = {
      kind: RuleEventKind.HighValueChanged,
      ts: 100,
      symbolId: 'AAPL',
      prev: 101,
      current: 105,
    };
    expect(event).toEqual({
      kind: RuleEventKind.HighValueChanged,
      ts: 100,
      symbolId: 'AAPL',
      prev: 101,
      current: 105,
    });
  });

  it('constructs a LowValueChangedEvent', () => {
    const event: LowValueChangedEvent = {
      kind: RuleEventKind.LowValueChanged,
      ts: 100,
      symbolId: 'AAPL',
      prev: 98,
      current: 95,
    };
    expect(event).toEqual({
      kind: RuleEventKind.LowValueChanged,
      ts: 100,
      symbolId: 'AAPL',
      prev: 98,
      current: 95,
    });
  });

  it('constructs a CloseValueChangedEvent', () => {
    const event: CloseValueChangedEvent = {
      kind: RuleEventKind.CloseValueChanged,
      ts: 100,
      symbolId: 'AAPL',
      prev: 99,
      current: 100,
    };
    expect(event).toEqual({
      kind: RuleEventKind.CloseValueChanged,
      ts: 100,
      symbolId: 'AAPL',
      prev: 99,
      current: 100,
    });
  });

  it('constructs a VolumeValueChangedEvent', () => {
    const event: VolumeValueChangedEvent = {
      kind: RuleEventKind.VolumeValueChanged,
      ts: 100,
      symbolId: 'AAPL',
      prev: 1000,
      current: 1500,
    };
    expect(event).toEqual({
      kind: RuleEventKind.VolumeValueChanged,
      ts: 100,
      symbolId: 'AAPL',
      prev: 1000,
      current: 1500,
    });
  });

  it('constructs a SymbolStateChangedEvent', () => {
    const event: SymbolStateChangedEvent = {
      kind: RuleEventKind.SymbolStateChanged,
      ts: 100,
      symbolId: 'AAPL',
      key: 'armed',
      prev: null,
      current: { type: StateValueType.Bool, value: true },
    };
    expect(event).toEqual({
      kind: RuleEventKind.SymbolStateChanged,
      ts: 100,
      symbolId: 'AAPL',
      key: 'armed',
      prev: null,
      current: { type: StateValueType.Bool, value: true },
    });
  });

  it('constructs a GlobalStateChangedEvent', () => {
    const event: GlobalStateChangedEvent = {
      kind: RuleEventKind.GlobalStateChanged,
      ts: 100,
      symbolId: null,
      key: 'regime',
      prev: { type: StateValueType.Enum, value: 'risk-off' },
      current: { type: StateValueType.Enum, value: 'risk-on' },
    };
    expect(event).toEqual({
      kind: RuleEventKind.GlobalStateChanged,
      ts: 100,
      symbolId: null,
      key: 'regime',
      prev: { type: StateValueType.Enum, value: 'risk-off' },
      current: { type: StateValueType.Enum, value: 'risk-on' },
    });
  });

  it('constructs an IndicatorValueChangedEvent', () => {
    const event: IndicatorValueChangedEvent = {
      kind: RuleEventKind.IndicatorValueChanged,
      ts: 100,
      symbolId: 'AAPL',
      instanceId: 'sma-14',
      stateKey: 'value',
      prev: { type: StateValueType.Number, value: 99 },
      current: { type: StateValueType.Number, value: 100 },
    };
    expect(event).toEqual({
      kind: RuleEventKind.IndicatorValueChanged,
      ts: 100,
      symbolId: 'AAPL',
      instanceId: 'sma-14',
      stateKey: 'value',
      prev: { type: StateValueType.Number, value: 99 },
      current: { type: StateValueType.Number, value: 100 },
    });
  });
});
