import {
  type ChannelLeafCondition,
  ChannelOperator,
  type ComparisonLeafCondition,
  ComparisonOperator,
  type ConditionOperand,
  type CrossingLeafCondition,
  CrossingOperator,
  LeafConditionFamily,
  type MovingLeafCondition,
  MovingOperator,
  OperandKind,
  type StateLeafCondition,
  StateOperator,
  type StateValue,
  StateValueType,
} from '@lametrader/core';

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
    if (operand.kind === OperandKind.Literal) return operand.value;
    if (operand.kind === OperandKind.Price) return { type: StateValueType.Number, value: 120 };
    if (operand.kind === OperandKind.SymbolStateRef) return up;
    return null;
  },
  resolvePrev: (operand) => {
    if (operand.kind === OperandKind.Literal) return operand.value;
    if (operand.kind === OperandKind.SymbolStateRef) return down;
    return null;
  },
  resolveSeries: (operand) => {
    if (operand.kind === OperandKind.Price) {
      return seriesOf([
        [100, 90],
        [200, 110],
      ]);
    }
    if (operand.kind === OperandKind.Literal) {
      return new ArraySeriesView([{ ts: 0, value: operand.value }]);
    }
    return EMPTY_SERIES;
  },
};

const literal100: ConditionOperand = {
  kind: OperandKind.Literal,
  value: { type: StateValueType.Number, value: 100 },
};

describe('evaluateLeaf', () => {
  it('dispatches every LeafConditionFamily variant to its operator function and returns the resulting boolean', () => {
    const comparison: ComparisonLeafCondition = {
      family: LeafConditionFamily.Comparison,
      operator: ComparisonOperator.Gt,
      left: { kind: OperandKind.Price },
      right: literal100,
    };
    const crossing: CrossingLeafCondition = {
      family: LeafConditionFamily.Crossing,
      operator: CrossingOperator.CrossingUp,
      left: { kind: OperandKind.Price },
      right: literal100,
    };
    const channel: ChannelLeafCondition = {
      family: LeafConditionFamily.Channel,
      operator: ChannelOperator.InsideChannel,
      left: { kind: OperandKind.Price },
      lower: {
        kind: OperandKind.Literal,
        value: { type: StateValueType.Number, value: 100 },
      },
      upper: {
        kind: OperandKind.Literal,
        value: { type: StateValueType.Number, value: 130 },
      },
    };
    const moving: MovingLeafCondition = {
      family: LeafConditionFamily.Moving,
      operator: MovingOperator.MovingUp,
      left: { kind: OperandKind.Price },
      threshold: 15,
      lookbackBars: 1,
    };
    const state: StateLeafCondition = {
      family: LeafConditionFamily.State,
      operator: StateOperator.ChangesTo,
      left: {
        kind: OperandKind.SymbolStateRef,
        key: 'trend',
        valueType: StateValueType.String,
      },
      right: { kind: OperandKind.Literal, value: up },
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
