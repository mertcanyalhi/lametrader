import { RulesV2, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { referencesSlot } from './references-slot.js';

const SYMBOL_STATE_CHANGED: RulesV2.SymbolStateChangedEvent = {
  kind: RulesV2.EvaluationTriggerKind.SymbolStateChanged,
  ts: 1_000,
  symbolId: 'AAPL',
  profileId: 'profile-1',
  key: 'isBullish',
  prev: null,
  current: { type: StateValueType.Bool, value: true },
};

const GLOBAL_STATE_CHANGED: RulesV2.GlobalStateChangedEvent = {
  kind: RulesV2.EvaluationTriggerKind.GlobalStateChanged,
  ts: 1_000,
  profileId: 'profile-1',
  key: 'marketMood',
  prev: null,
  current: { type: StateValueType.String, value: 'risk-on' },
};

const INDICATOR_CHANGED: RulesV2.IndicatorChangedEvent = {
  kind: RulesV2.EvaluationTriggerKind.IndicatorChanged,
  ts: 1_000,
  symbolId: 'AAPL',
  instanceId: 'rsi-14',
  stateKey: 'value',
  prev: null,
  current: { type: StateValueType.Number, value: 30 },
};

function leaf(left: RulesV2.ConditionOperand): RulesV2.ConditionNode {
  return {
    kind: RulesV2.ConditionNodeKind.Leaf,
    leaf: {
      family: RulesV2.LeafConditionFamily.Comparison,
      operator: RulesV2.ComparisonOperator.Eq,
      left,
      right: {
        kind: RulesV2.OperandKind.Literal,
        value: { type: StateValueType.Bool, value: true },
      },
    },
  };
}

describe('referencesSlot — cascade-event slot lookup', () => {
  it('matches a leaf reading the same symbol-state key', () => {
    const condition = leaf({
      kind: RulesV2.OperandKind.SymbolStateRef,
      key: 'isBullish',
      valueType: StateValueType.Bool,
    });
    expect(referencesSlot(condition, SYMBOL_STATE_CHANGED)).toEqual(true);
  });

  it('refuses a leaf reading a different symbol-state key', () => {
    const condition = leaf({
      kind: RulesV2.OperandKind.SymbolStateRef,
      key: 'isBearish',
      valueType: StateValueType.Bool,
    });
    expect(referencesSlot(condition, SYMBOL_STATE_CHANGED)).toEqual(false);
  });

  it('matches a leaf reading the same global-state key', () => {
    const condition = leaf({
      kind: RulesV2.OperandKind.GlobalStateRef,
      key: 'marketMood',
      valueType: StateValueType.String,
    });
    expect(referencesSlot(condition, GLOBAL_STATE_CHANGED)).toEqual(true);
  });

  it('refuses a leaf reading a different global-state key', () => {
    const condition = leaf({
      kind: RulesV2.OperandKind.GlobalStateRef,
      key: 'fearGauge',
      valueType: StateValueType.String,
    });
    expect(referencesSlot(condition, GLOBAL_STATE_CHANGED)).toEqual(false);
  });

  it('matches a leaf reading the same indicator instance and state key', () => {
    const condition = leaf({
      kind: RulesV2.OperandKind.IndicatorRef,
      instanceId: 'rsi-14',
      stateKey: 'value',
      valueType: StateValueType.Number,
    });
    expect(referencesSlot(condition, INDICATOR_CHANGED)).toEqual(true);
  });

  it('refuses a leaf reading a different indicator instance', () => {
    const condition = leaf({
      kind: RulesV2.OperandKind.IndicatorRef,
      instanceId: 'rsi-21',
      stateKey: 'value',
      valueType: StateValueType.Number,
    });
    expect(referencesSlot(condition, INDICATOR_CHANGED)).toEqual(false);
  });

  it('refuses a leaf reading the same indicator instance but a different state key', () => {
    const condition = leaf({
      kind: RulesV2.OperandKind.IndicatorRef,
      instanceId: 'rsi-14',
      stateKey: 'overbought',
      valueType: StateValueType.Bool,
    });
    expect(referencesSlot(condition, INDICATOR_CHANGED)).toEqual(false);
  });

  it('walks into nested And groups to find the slot reference', () => {
    const condition: RulesV2.ConditionNode = {
      kind: RulesV2.ConditionNodeKind.And,
      children: [
        leaf({
          kind: RulesV2.OperandKind.GlobalStateRef,
          key: 'unrelated',
          valueType: StateValueType.String,
        }),
        leaf({
          kind: RulesV2.OperandKind.SymbolStateRef,
          key: 'isBullish',
          valueType: StateValueType.Bool,
        }),
      ],
    };
    expect(referencesSlot(condition, SYMBOL_STATE_CHANGED)).toEqual(true);
  });

  it('walks into nested Or groups to find the slot reference', () => {
    const condition: RulesV2.ConditionNode = {
      kind: RulesV2.ConditionNodeKind.Or,
      children: [
        leaf({
          kind: RulesV2.OperandKind.SymbolStateRef,
          key: 'other',
          valueType: StateValueType.Bool,
        }),
        {
          kind: RulesV2.ConditionNodeKind.And,
          children: [
            leaf({
              kind: RulesV2.OperandKind.IndicatorRef,
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
    const condition = leaf({ kind: RulesV2.OperandKind.Price });
    expect(referencesSlot(condition, SYMBOL_STATE_CHANGED)).toEqual(false);
  });
});
