import { OperandKind, RuleEventKind, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { buildEvaluationContext } from './evaluation-context.js';
import type { EvaluationLookups } from './evaluation-context.types.js';

/** Baseline lookups that return `null` for everything. */
function emptyLookups(): EvaluationLookups {
  return {
    getCurrentValue: () => null,
    getOpenValue: () => null,
    getHighValue: () => null,
    getLowValue: () => null,
    getCloseValue: () => null,
    getVolumeValue: () => null,
    getIndicatorValue: () => null,
    getSymbolState: () => null,
    getGlobalState: () => null,
    getPrevCurrentValue: () => null,
    getPrevOpenValue: () => null,
    getPrevHighValue: () => null,
    getPrevLowValue: () => null,
    getPrevCloseValue: () => null,
    getPrevVolumeValue: () => null,
    getPrevIndicatorValue: () => null,
    getPrevSymbolState: () => null,
    getPrevGlobalState: () => null,
  };
}

describe('buildEvaluationContext', () => {
  it('exposes prev=null and current=null for a TimerEvent', () => {
    const context = buildEvaluationContext(
      { kind: RuleEventKind.Timer, ts: 1000, symbolId: null },
      emptyLookups(),
      'profile-1',
    );
    expect({ prev: context.prev, current: context.current }).toEqual({
      prev: null,
      current: null,
    });
  });

  it('wraps OHLCV prev/current as StateValue.Number', () => {
    const context = buildEvaluationContext(
      {
        kind: RuleEventKind.CurrentValueChanged,
        ts: 1000,
        symbolId: 'AAPL',
        prev: 99,
        current: 100,
        final: false,
      },
      emptyLookups(),
      'profile-1',
    );
    expect({ prev: context.prev, current: context.current }).toEqual({
      prev: { type: StateValueType.Number, value: 99 },
      current: { type: StateValueType.Number, value: 100 },
    });
  });

  it('forwards prev/current as-is for SymbolStateChanged events', () => {
    const context = buildEvaluationContext(
      {
        kind: RuleEventKind.SymbolStateChanged,
        ts: 1000,
        symbolId: 'AAPL',
        profileId: 'profile-1',
        key: 'armed',
        prev: { type: StateValueType.Bool, value: false },
        current: { type: StateValueType.Bool, value: true },
      },
      emptyLookups(),
      'profile-1',
    );
    expect({ prev: context.prev, current: context.current }).toEqual({
      prev: { type: StateValueType.Bool, value: false },
      current: { type: StateValueType.Bool, value: true },
    });
  });

  it('resolves a Literal operand to its wrapped value', () => {
    const context = buildEvaluationContext(
      { kind: RuleEventKind.Timer, ts: 1000, symbolId: null },
      emptyLookups(),
      'profile-1',
    );
    expect(
      context.resolve({
        kind: OperandKind.Literal,
        value: { type: StateValueType.Number, value: 100 },
      }),
    ).toEqual({ type: StateValueType.Number, value: 100 });
  });

  it('resolves an OHLCV operand via the matching lookup wrapped as Number', () => {
    const lookups: EvaluationLookups = {
      ...emptyLookups(),
      getCurrentValue: (id) => (id === 'AAPL' ? 100 : null),
    };
    const context = buildEvaluationContext(
      {
        kind: RuleEventKind.CurrentValueChanged,
        ts: 1000,
        symbolId: 'AAPL',
        prev: null,
        current: 100,
        final: false,
      },
      lookups,
      'profile-1',
    );
    expect(
      context.resolve({
        kind: OperandKind.CurrentValue,
        valueType: StateValueType.Number,
      }),
    ).toEqual({ type: StateValueType.Number, value: 100 });
  });

  it('resolves OHLCV operands to null when the event has no symbolId (TimerEvent)', () => {
    const lookups: EvaluationLookups = {
      ...emptyLookups(),
      getOpenValue: () => 100,
    };
    const context = buildEvaluationContext(
      { kind: RuleEventKind.Timer, ts: 1000, symbolId: null },
      lookups,
      'profile-1',
    );
    expect(
      context.resolve({
        kind: OperandKind.OpenValue,
        valueType: StateValueType.Number,
      }),
    ).toBeNull();
  });

  it('resolves an IndicatorRef operand via the indicator lookup', () => {
    const lookups: EvaluationLookups = {
      ...emptyLookups(),
      getIndicatorValue: (instanceId, stateKey) =>
        instanceId === 'sma-14' && stateKey === 'value'
          ? { type: StateValueType.Number, value: 100 }
          : null,
    };
    const context = buildEvaluationContext(
      { kind: RuleEventKind.Timer, ts: 1000, symbolId: null },
      lookups,
      'profile-1',
    );
    expect(
      context.resolve({
        kind: OperandKind.IndicatorRef,
        instanceId: 'sma-14',
        stateKey: 'value',
        valueType: StateValueType.Number,
      }),
    ).toEqual({ type: StateValueType.Number, value: 100 });
  });

  it('resolves a SymbolStateRef operand via the symbol-state lookup with the rule profileId', () => {
    const lookups: EvaluationLookups = {
      ...emptyLookups(),
      getSymbolState: (profileId, symbolId, key) =>
        profileId === 'profile-1' && symbolId === 'AAPL' && key === 'armed'
          ? { type: StateValueType.Bool, value: true }
          : null,
    };
    const context = buildEvaluationContext(
      {
        kind: RuleEventKind.CurrentValueChanged,
        ts: 1000,
        symbolId: 'AAPL',
        prev: null,
        current: 100,
        final: false,
      },
      lookups,
      'profile-1',
    );
    expect(
      context.resolve({
        kind: OperandKind.SymbolStateRef,
        key: 'armed',
        valueType: StateValueType.Bool,
      }),
    ).toEqual({ type: StateValueType.Bool, value: true });
  });

  it("returns null from a SymbolStateRef operand when the rule profileId differs from the stored value's profile", () => {
    const lookups: EvaluationLookups = {
      ...emptyLookups(),
      getSymbolState: (profileId, symbolId, key) =>
        profileId === 'profile-1' && symbolId === 'AAPL' && key === 'armed'
          ? { type: StateValueType.Bool, value: true }
          : null,
    };
    const context = buildEvaluationContext(
      {
        kind: RuleEventKind.CurrentValueChanged,
        ts: 1000,
        symbolId: 'AAPL',
        prev: null,
        current: 100,
        final: false,
      },
      lookups,
      'profile-2',
    );
    expect(
      context.resolve({
        kind: OperandKind.SymbolStateRef,
        key: 'armed',
        valueType: StateValueType.Bool,
      }),
    ).toBeNull();
  });

  it('resolves a GlobalStateRef operand via the global-state lookup with the rule profileId', () => {
    const lookups: EvaluationLookups = {
      ...emptyLookups(),
      getGlobalState: (profileId, key) =>
        profileId === 'profile-1' && key === 'regime'
          ? { type: StateValueType.Enum, value: 'risk-on' }
          : null,
    };
    const context = buildEvaluationContext(
      { kind: RuleEventKind.Timer, ts: 1000, symbolId: null },
      lookups,
      'profile-1',
    );
    expect(
      context.resolve({
        kind: OperandKind.GlobalStateRef,
        key: 'regime',
        valueType: StateValueType.Enum,
      }),
    ).toEqual({ type: StateValueType.Enum, value: 'risk-on' });
  });

  it('resolvePrev returns the prev close value for a CloseValue operand', () => {
    const lookups: EvaluationLookups = {
      ...emptyLookups(),
      getPrevCloseValue: (id) => (id === 'AAPL' ? 99 : null),
    };
    const context = buildEvaluationContext(
      {
        kind: RuleEventKind.CloseValueChanged,
        ts: 1000,
        symbolId: 'AAPL',
        prev: 99,
        current: 101,
        final: false,
      },
      lookups,
      'profile-1',
    );
    expect(
      context.resolvePrev({
        kind: OperandKind.CloseValue,
        valueType: StateValueType.Number,
      }),
    ).toEqual({ type: StateValueType.Number, value: 99 });
  });

  it('resolvePrev returns the prev indicator value for an IndicatorRef operand', () => {
    const lookups: EvaluationLookups = {
      ...emptyLookups(),
      getPrevIndicatorValue: (instanceId, stateKey) =>
        instanceId === 'sma-14' && stateKey === 'value'
          ? { type: StateValueType.Number, value: 110 }
          : null,
    };
    const context = buildEvaluationContext(
      { kind: RuleEventKind.Timer, ts: 1000, symbolId: null },
      lookups,
      'profile-1',
    );
    expect(
      context.resolvePrev({
        kind: OperandKind.IndicatorRef,
        instanceId: 'sma-14',
        stateKey: 'value',
        valueType: StateValueType.Number,
      }),
    ).toEqual({ type: StateValueType.Number, value: 110 });
  });

  it('resolvePrev returns the literal value as-is (no prev concept for a constant)', () => {
    const context = buildEvaluationContext(
      { kind: RuleEventKind.Timer, ts: 1000, symbolId: null },
      emptyLookups(),
      'profile-1',
    );
    expect(
      context.resolvePrev({
        kind: OperandKind.Literal,
        value: { type: StateValueType.Number, value: 100 },
      }),
    ).toEqual({ type: StateValueType.Number, value: 100 });
  });
});
