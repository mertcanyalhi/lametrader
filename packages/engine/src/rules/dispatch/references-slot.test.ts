import {
  ComparisonOperator,
  type ConditionNode,
  ConditionNodeKind,
  type ConditionOperand,
  EvaluationTriggerKind,
  type GlobalStateChangedEvent,
  type IndicatorChangedEvent,
  LeafConditionFamily,
  OperandKind,
  StateValueType,
  type SymbolStateChangedEvent,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { referencesSlot } from './references-slot.js';

const SYMBOL_STATE_CHANGED: SymbolStateChangedEvent = {
  kind: EvaluationTriggerKind.SymbolStateChanged,
  ts: 1_000,
  symbolId: 'AAPL',
  profileId: 'profile-1',
  key: 'isBullish',
  prev: null,
  current: { type: StateValueType.Bool, value: true },
};

const GLOBAL_STATE_CHANGED: GlobalStateChangedEvent = {
  kind: EvaluationTriggerKind.GlobalStateChanged,
  ts: 1_000,
  profileId: 'profile-1',
  key: 'marketMood',
  prev: null,
  current: { type: StateValueType.String, value: 'risk-on' },
};

const INDICATOR_CHANGED: IndicatorChangedEvent = {
  kind: EvaluationTriggerKind.IndicatorChanged,
  ts: 1_000,
  symbolId: 'AAPL',
  instanceId: 'rsi-14',
  stateKey: 'value',
  prev: null,
  current: { type: StateValueType.Number, value: 30 },
};

function leaf(left: ConditionOperand): ConditionNode {
  return {
    kind: ConditionNodeKind.Leaf,
    leaf: {
      family: LeafConditionFamily.Comparison,
      operator: ComparisonOperator.Eq,
      left,
      right: {
        kind: OperandKind.Literal,
        value: { type: StateValueType.Bool, value: true },
      },
    },
  };
}

describe('referencesSlot — cascade-event slot lookup', () => {
  it('matches a leaf reading the same symbol-state key', () => {
    const condition = leaf({
      kind: OperandKind.SymbolStateRef,
      key: 'isBullish',
      valueType: StateValueType.Bool,
    });
    expect(referencesSlot(condition, SYMBOL_STATE_CHANGED)).toEqual(true);
  });

  it('refuses a leaf reading a different symbol-state key', () => {
    const condition = leaf({
      kind: OperandKind.SymbolStateRef,
      key: 'isBearish',
      valueType: StateValueType.Bool,
    });
    expect(referencesSlot(condition, SYMBOL_STATE_CHANGED)).toEqual(false);
  });

  it('matches a leaf reading the same global-state key', () => {
    const condition = leaf({
      kind: OperandKind.GlobalStateRef,
      key: 'marketMood',
      valueType: StateValueType.String,
    });
    expect(referencesSlot(condition, GLOBAL_STATE_CHANGED)).toEqual(true);
  });

  it('refuses a leaf reading a different global-state key', () => {
    const condition = leaf({
      kind: OperandKind.GlobalStateRef,
      key: 'fearGauge',
      valueType: StateValueType.String,
    });
    expect(referencesSlot(condition, GLOBAL_STATE_CHANGED)).toEqual(false);
  });

  it('matches a leaf reading the same indicator instance and state key', () => {
    const condition = leaf({
      kind: OperandKind.IndicatorRef,
      instanceId: 'rsi-14',
      stateKey: 'value',
      valueType: StateValueType.Number,
    });
    expect(referencesSlot(condition, INDICATOR_CHANGED)).toEqual(true);
  });

  it('refuses a leaf reading a different indicator instance', () => {
    const condition = leaf({
      kind: OperandKind.IndicatorRef,
      instanceId: 'rsi-21',
      stateKey: 'value',
      valueType: StateValueType.Number,
    });
    expect(referencesSlot(condition, INDICATOR_CHANGED)).toEqual(false);
  });

  it('refuses a leaf reading the same indicator instance but a different state key', () => {
    const condition = leaf({
      kind: OperandKind.IndicatorRef,
      instanceId: 'rsi-14',
      stateKey: 'overbought',
      valueType: StateValueType.Bool,
    });
    expect(referencesSlot(condition, INDICATOR_CHANGED)).toEqual(false);
  });

  it('walks into nested And groups to find the slot reference', () => {
    const condition: ConditionNode = {
      kind: ConditionNodeKind.And,
      children: [
        leaf({
          kind: OperandKind.GlobalStateRef,
          key: 'unrelated',
          valueType: StateValueType.String,
        }),
        leaf({
          kind: OperandKind.SymbolStateRef,
          key: 'isBullish',
          valueType: StateValueType.Bool,
        }),
      ],
    };
    expect(referencesSlot(condition, SYMBOL_STATE_CHANGED)).toEqual(true);
  });

  it('walks into nested Or groups to find the slot reference', () => {
    const condition: ConditionNode = {
      kind: ConditionNodeKind.Or,
      children: [
        leaf({
          kind: OperandKind.SymbolStateRef,
          key: 'other',
          valueType: StateValueType.Bool,
        }),
        {
          kind: ConditionNodeKind.And,
          children: [
            leaf({
              kind: OperandKind.IndicatorRef,
              instanceId: 'rsi-14',
              stateKey: 'value',
              valueType: StateValueType.Number,
            }),
          ],
        },
      ],
    };
    expect(referencesSlot(condition, INDICATOR_CHANGED)).toEqual(true);
  });

  it('returns false when no operand reads any state slot at all', () => {
    const condition = leaf({ kind: OperandKind.Price });
    expect(referencesSlot(condition, SYMBOL_STATE_CHANGED)).toEqual(false);
  });
});
