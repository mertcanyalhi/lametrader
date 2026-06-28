import { RulesV2, type StateValue, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import type { EvaluationContext } from '../evaluation-context.types.js';
import { ArraySeriesView } from '../indicator-series-store.js';
import type { SeriesPoint, SeriesView } from '../series.types.js';
import { evaluateLeaf } from './dispatch.js';

const EMPTY_SERIES: SeriesView = new ArraySeriesView([]);

const seriesOf = (samples: Array<[number, number]>): SeriesView => {
  const points: SeriesPoint[] = samples.map(([ts, value]) => ({
    ts,
    value: { type: StateValueType.Number, value },
  }));
  return new ArraySeriesView(points);
};

const up: StateValue = { type: StateValueType.String, value: 'up' };
const down: StateValue = { type: StateValueType.String, value: 'down' };

const ctx: EvaluationContext = {
  symbolId: 'BTC',
  resolveLatest: (operand) => {
    if (operand.kind === RulesV2.OperandKind.Literal) return operand.value;
    if (operand.kind === RulesV2.OperandKind.Price)
      return { type: StateValueType.Number, value: 120 };
    if (operand.kind === RulesV2.OperandKind.SymbolStateRef) return up;
    return null;
  },
  resolvePrev: (operand) => {
    if (operand.kind === RulesV2.OperandKind.Literal) return operand.value;
    if (operand.kind === RulesV2.OperandKind.SymbolStateRef) return down;
    return null;
  },
  resolveSeries: (operand) => {
    if (operand.kind === RulesV2.OperandKind.Price) {
      return seriesOf([
        [100, 90],
        [200, 110],
      ]);
    }
    if (operand.kind === RulesV2.OperandKind.Literal) {
      return new ArraySeriesView([{ ts: 0, value: operand.value }]);
    }
    return EMPTY_SERIES;
  },
};

const literal100: RulesV2.ConditionOperand = {
  kind: RulesV2.OperandKind.Literal,
  value: { type: StateValueType.Number, value: 100 },
};

describe('evaluateLeaf', () => {
  it('dispatches every LeafConditionFamily variant to its operator function and returns the resulting boolean', () => {
    const comparison: RulesV2.ComparisonLeafCondition = {
      family: RulesV2.LeafConditionFamily.Comparison,
      operator: RulesV2.ComparisonOperator.Gt,
      left: { kind: RulesV2.OperandKind.Price },
      right: literal100,
    };
    const crossing: RulesV2.CrossingLeafCondition = {
      family: RulesV2.LeafConditionFamily.Crossing,
      operator: RulesV2.CrossingOperator.CrossingUp,
      left: { kind: RulesV2.OperandKind.Price },
      right: literal100,
    };
    const channel: RulesV2.ChannelLeafCondition = {
      family: RulesV2.LeafConditionFamily.Channel,
      operator: RulesV2.ChannelOperator.InsideChannel,
      left: { kind: RulesV2.OperandKind.Price },
      lower: {
        kind: RulesV2.OperandKind.Literal,
        value: { type: StateValueType.Number, value: 100 },
      },
      upper: {
        kind: RulesV2.OperandKind.Literal,
        value: { type: StateValueType.Number, value: 130 },
      },
    };
    const moving: RulesV2.MovingLeafCondition = {
      family: RulesV2.LeafConditionFamily.Moving,
      operator: RulesV2.MovingOperator.MovingUp,
      left: { kind: RulesV2.OperandKind.Price },
      threshold: 15,
      lookbackBars: 1,
    };
    const state: RulesV2.StateLeafCondition = {
      family: RulesV2.LeafConditionFamily.State,
      operator: RulesV2.StateOperator.ChangesTo,
      left: {
        kind: RulesV2.OperandKind.SymbolStateRef,
        key: 'trend',
        valueType: StateValueType.String,
      },
      right: { kind: RulesV2.OperandKind.Literal, value: up },
    };
    expect({
      comparison: evaluateLeaf(comparison, ctx),
      crossing: evaluateLeaf(crossing, ctx),
      channel: evaluateLeaf(channel, ctx),
      moving: evaluateLeaf(moving, ctx),
      state: evaluateLeaf(state, ctx),
    }).toEqual({
      comparison: true,
      crossing: true,
      channel: true,
      moving: true,
      state: true,
    });
  });
});
