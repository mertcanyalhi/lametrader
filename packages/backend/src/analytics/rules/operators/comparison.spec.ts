import {
  type ComparisonLeafCondition,
  ComparisonOperator,
  type ConditionOperand,
  LeafConditionFamily,
  OperandKind,
  type StateValue,
  StateValueType,
} from '@lametrader/core';

import type { EvaluationContext } from '../evaluation-context.types.js';
import { ArraySeriesView } from '../indicator-series-store.js';
import type { SeriesView } from '../series.types.js';
import { evaluateComparison } from './comparison.js';

const EMPTY_SERIES: SeriesView = new ArraySeriesView([]);

/**
 * Build a minimal {@link EvaluationContext} for unit tests against a single
 * operator family.
 * `latest` keys operands by `kind`; series operands fall through to an empty
 * series since the comparison family doesn't read series at all.
 */
const fakeCtx = (latest: Partial<Record<OperandKind, StateValue | null>>): EvaluationContext => ({
  symbolId: 'BTC',
  resolveLatest: (operand) => latest[operand.kind] ?? null,
  resolvePrev: () => null,
  resolveSeries: () => EMPTY_SERIES,
});

const literal100: ConditionOperand = {
  kind: OperandKind.Literal,
  value: { type: StateValueType.Number, value: 100 },
};

const priceGt100: ComparisonLeafCondition = {
  family: LeafConditionFamily.Comparison,
  operator: ComparisonOperator.Gt,
  left: { kind: OperandKind.Price },
  right: literal100,
};

describe('evaluateComparison', () => {
  it('returns true for Gt when the resolved left number is strictly greater than the right (both read via resolveLatest)', () => {
    const ctx = fakeCtx({
      [OperandKind.Price]: { type: StateValueType.Number, value: 120 },
      [OperandKind.Literal]: { type: StateValueType.Number, value: 100 },
    });
    expect(evaluateComparison(priceGt100, ctx)).toBe(true);
  });

  it('returns false (does not throw) when an operand is null, the StateValueTypes differ, or a value is NaN', () => {
    const nullLeftCtx = fakeCtx({
      [OperandKind.Price]: null,
      [OperandKind.Literal]: { type: StateValueType.Number, value: 100 },
    });
    const typeMismatchCtx = fakeCtx({
      [OperandKind.SymbolStateRef]: { type: StateValueType.String, value: 'up' },
      [OperandKind.Literal]: { type: StateValueType.Number, value: 100 },
    });
    const nanLeftCtx = fakeCtx({
      [OperandKind.Price]: { type: StateValueType.Number, value: Number.NaN },
      [OperandKind.Literal]: { type: StateValueType.Number, value: 100 },
    });
    const typeMismatchLeaf: ComparisonLeafCondition = {
      family: LeafConditionFamily.Comparison,
      operator: ComparisonOperator.Eq,
      left: {
        kind: OperandKind.SymbolStateRef,
        key: 'trend',
        valueType: StateValueType.String,
      },
      right: literal100,
    };
    expect({
      nullLeft: evaluateComparison(priceGt100, nullLeftCtx),
      typeMismatch: evaluateComparison(typeMismatchLeaf, typeMismatchCtx),
      nanLeft: evaluateComparison(priceGt100, nanLeftCtx),
    }).toEqual({ nullLeft: false, typeMismatch: false, nanLeft: false });
  });
});
