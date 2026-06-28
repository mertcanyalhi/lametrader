import { RulesV2, type StateValue, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

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
const fakeCtx = (
  latest: Partial<Record<RulesV2.OperandKind, StateValue | null>>,
): EvaluationContext => ({
  symbolId: 'BTC',
  resolveLatest: (operand) => latest[operand.kind] ?? null,
  resolvePrev: () => null,
  resolveSeries: () => EMPTY_SERIES,
});

const literal100: RulesV2.ConditionOperand = {
  kind: RulesV2.OperandKind.Literal,
  value: { type: StateValueType.Number, value: 100 },
};

const priceGt100: RulesV2.ComparisonLeafCondition = {
  family: RulesV2.LeafConditionFamily.Comparison,
  operator: RulesV2.ComparisonOperator.Gt,
  left: { kind: RulesV2.OperandKind.Price },
  right: literal100,
};

describe('evaluateComparison', () => {
  it('returns true for Gt when the resolved left number is strictly greater than the right (both read via resolveLatest)', () => {
    const ctx = fakeCtx({
      [RulesV2.OperandKind.Price]: { type: StateValueType.Number, value: 120 },
      [RulesV2.OperandKind.Literal]: { type: StateValueType.Number, value: 100 },
    });
    expect(evaluateComparison(priceGt100, ctx)).toBe(true);
  });

  it('returns false (does not throw) when an operand is null, the StateValueTypes differ, or a value is NaN', () => {
    const nullLeftCtx = fakeCtx({
      [RulesV2.OperandKind.Price]: null,
      [RulesV2.OperandKind.Literal]: { type: StateValueType.Number, value: 100 },
    });
    const typeMismatchCtx = fakeCtx({
      [RulesV2.OperandKind.SymbolStateRef]: { type: StateValueType.String, value: 'up' },
      [RulesV2.OperandKind.Literal]: { type: StateValueType.Number, value: 100 },
    });
    const nanLeftCtx = fakeCtx({
      [RulesV2.OperandKind.Price]: { type: StateValueType.Number, value: Number.NaN },
      [RulesV2.OperandKind.Literal]: { type: StateValueType.Number, value: 100 },
    });
    const typeMismatchLeaf: RulesV2.ComparisonLeafCondition = {
      family: RulesV2.LeafConditionFamily.Comparison,
      operator: RulesV2.ComparisonOperator.Eq,
      left: {
        kind: RulesV2.OperandKind.SymbolStateRef,
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
