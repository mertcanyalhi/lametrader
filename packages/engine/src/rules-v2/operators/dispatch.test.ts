import { Period, RulesV2, type StateValue, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { buildEvaluationContext } from '../evaluation-context.js';
import type { EvaluationLookups } from '../evaluation-context.types.js';
import type { SeriesSample, SeriesView } from '../series.types.js';
import { evaluateLeaf } from './dispatch.js';

const seriesOf = (samples: SeriesSample[]): SeriesView => ({
  length: () => samples.length,
  samples: () => samples,
  latest: () => samples[samples.length - 1] ?? null,
  asOf: (asOfTs) => {
    for (let i = samples.length - 1; i >= 0; i--) {
      const s = samples[i] as SeriesSample;
      if (s.ts <= asOfTs) return s;
    }
    return null;
  },
});

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

describe('evaluateLeaf', () => {
  it('dispatches every LeafCondition family to its operator function and returns the resulting boolean', () => {
    const ctx = buildCtx(
      fakeLookups({
        latestPrice: () => 120,
        priceSeries: () =>
          seriesOf([
            { ts: 100, value: 90 },
            { ts: 200, value: 110 },
          ]),
        latestSymbolState: () =>
          ({ type: StateValueType.String, value: 'up' }) satisfies StateValue,
        prevSymbolState: () =>
          ({ type: StateValueType.String, value: 'down' }) satisfies StateValue,
      }),
    );
    const literalUpString: RulesV2.ConditionOperand = {
      kind: RulesV2.OperandKind.Literal,
      value: { type: StateValueType.String, value: 'up' },
    };
    const literal100: RulesV2.ConditionOperand = {
      kind: RulesV2.OperandKind.Literal,
      value: { type: StateValueType.Number, value: 100 },
    };
    expect(
      evaluateLeaf(
        {
          family: RulesV2.LeafConditionFamily.Comparison,
          operator: RulesV2.ComparisonOperator.Gt,
          left: { kind: RulesV2.OperandKind.Price },
          right: literal100,
        },
        ctx,
      ),
    ).toBe(true);
    expect(
      evaluateLeaf(
        {
          family: RulesV2.LeafConditionFamily.Crossing,
          operator: RulesV2.CrossingOperator.CrossingUp,
          left: { kind: RulesV2.OperandKind.Price },
          right: literal100,
        },
        ctx,
      ),
    ).toBe(true);
    expect(
      evaluateLeaf(
        {
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
        },
        ctx,
      ),
    ).toBe(true);
    expect(
      evaluateLeaf(
        {
          family: RulesV2.LeafConditionFamily.Moving,
          operator: RulesV2.MovingOperator.MovingUp,
          left: { kind: RulesV2.OperandKind.Price },
          threshold: 15,
          lookbackBars: 1,
        },
        ctx,
      ),
    ).toBe(true);
    expect(
      evaluateLeaf(
        {
          family: RulesV2.LeafConditionFamily.State,
          operator: RulesV2.StateOperator.ChangesTo,
          left: {
            kind: RulesV2.OperandKind.SymbolStateRef,
            key: 'trend',
            valueType: StateValueType.String,
          },
          right: literalUpString,
        },
        ctx,
      ),
    ).toBe(true);
  });
});
