import { Period, RulesV2, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { buildEvaluationContext } from '../evaluation-context.js';
import type { EvaluationLookups } from '../evaluation-context.types.js';
import { evaluateComparison } from './comparison.js';

const fakeLookups = (partial: Partial<EvaluationLookups> = {}): EvaluationLookups => ({
  latestPrice: () => null,
  latestOhlcv: () => null,
  latestIndicator: () => null,
  latestSymbolState: () => null,
  latestGlobalState: () => null,
  prevIndicator: () => null,
  prevSymbolState: () => null,
  prevGlobalState: () => null,
  priceSeries: () => null,
  barSeries: () => null,
  indicatorSeries: () => null,
  ...partial,
});

const tickEvent: RulesV2.EvaluationTriggerEvent = {
  kind: RulesV2.EvaluationTriggerKind.Tick,
  ts: 1_000,
  symbolId: 'BTC',
  price: 100,
};

const buildCtx = (lookups: EvaluationLookups) =>
  buildEvaluationContext({
    event: tickEvent,
    profileId: 'p1',
    symbolId: 'BTC',
    lookups,
    defaultPeriod: Period.OneMinute,
  });

describe('evaluateComparison', () => {
  it('returns true for Gt when the resolved left number is strictly greater than the resolved right number (both read via resolveLatest)', () => {
    const ctx = buildCtx(fakeLookups({ latestPrice: () => 120 }));
    const result = evaluateComparison(
      {
        family: RulesV2.LeafConditionFamily.Comparison,
        operator: RulesV2.ComparisonOperator.Gt,
        left: { kind: RulesV2.OperandKind.Price },
        right: {
          kind: RulesV2.OperandKind.Literal,
          value: { type: StateValueType.Number, value: 100 },
        },
      },
      ctx,
    );
    expect(result).toBe(true);
  });

  it('returns false (does not throw) when an operand is null, types differ, or a value is NaN', () => {
    const nullLeft = buildCtx(fakeLookups({ latestPrice: () => null }));
    const mismatchedTypes = buildCtx(
      fakeLookups({
        latestSymbolState: () => ({ type: StateValueType.String, value: 'up' }),
      }),
    );
    const nanLeft = buildCtx(fakeLookups({ latestPrice: () => Number.NaN }));
    const literal100: RulesV2.ConditionOperand = {
      kind: RulesV2.OperandKind.Literal,
      value: { type: StateValueType.Number, value: 100 },
    };
    expect(
      evaluateComparison(
        {
          family: RulesV2.LeafConditionFamily.Comparison,
          operator: RulesV2.ComparisonOperator.Gt,
          left: { kind: RulesV2.OperandKind.Price },
          right: literal100,
        },
        nullLeft,
      ),
    ).toBe(false);
    expect(
      evaluateComparison(
        {
          family: RulesV2.LeafConditionFamily.Comparison,
          operator: RulesV2.ComparisonOperator.Eq,
          left: {
            kind: RulesV2.OperandKind.SymbolStateRef,
            key: 'trend',
            valueType: StateValueType.String,
          },
          right: literal100,
        },
        mismatchedTypes,
      ),
    ).toBe(false);
    expect(
      evaluateComparison(
        {
          family: RulesV2.LeafConditionFamily.Comparison,
          operator: RulesV2.ComparisonOperator.Gt,
          left: { kind: RulesV2.OperandKind.Price },
          right: literal100,
        },
        nanLeft,
      ),
    ).toBe(false);
  });
});
