import { Period, RulesV2, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { buildEvaluationContext } from '../evaluation-context.js';
import type { EvaluationLookups } from '../evaluation-context.types.js';
import type { SeriesSample, SeriesView } from '../series.types.js';
import { evaluateCrossing } from './crossing.js';

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

const priceCrossingLiteral100 = (
  operator: RulesV2.CrossingOperator,
): RulesV2.CrossingLeafCondition => ({
  family: RulesV2.LeafConditionFamily.Crossing,
  operator,
  left: { kind: RulesV2.OperandKind.Price },
  right: { kind: RulesV2.OperandKind.Literal, value: { type: StateValueType.Number, value: 100 } },
});

describe('evaluateCrossing', () => {
  it('returns true for CrossingUp when the latest left strictly exceeds the right and the most recent non-flat baseline (asOf-resampled) was strictly below', () => {
    const samples: SeriesSample[] = [
      { ts: 100, value: 90 },
      { ts: 200, value: 95 },
      { ts: 300, value: 105 },
    ];
    const ctx = buildCtx(fakeLookups({ priceSeries: () => seriesOf(samples) }));
    expect(
      evaluateCrossing(priceCrossingLiteral100(RulesV2.CrossingOperator.CrossingUp), ctx),
    ).toBe(true);
  });

  it('skips historical points where left === right (lookback-past-flats) — consolidation at the threshold followed by a transit fires Crossing', () => {
    const samples: SeriesSample[] = [
      { ts: 100, value: 90 },
      { ts: 200, value: 100 },
      { ts: 300, value: 100 },
      { ts: 400, value: 100 },
      { ts: 500, value: 105 },
    ];
    const ctx = buildCtx(fakeLookups({ priceSeries: () => seriesOf(samples) }));
    expect(evaluateCrossing(priceCrossingLiteral100(RulesV2.CrossingOperator.Crossing), ctx)).toBe(
      true,
    );
  });

  it('produces the same verdict for cross-frequency (rare vs frequent right updates) — asOf resampling decouples cadence from result', () => {
    const leftSamples: SeriesSample[] = [
      { ts: 100, value: 90 },
      { ts: 200, value: 95 },
      { ts: 300, value: 105 },
    ];
    const rareRight: SeriesSample[] = [{ ts: 50, value: 100 }];
    const frequentRight: SeriesSample[] = [
      { ts: 50, value: 100 },
      { ts: 110, value: 100 },
      { ts: 170, value: 100 },
      { ts: 220, value: 100 },
      { ts: 290, value: 100 },
    ];
    const leaf: RulesV2.CrossingLeafCondition = {
      family: RulesV2.LeafConditionFamily.Crossing,
      operator: RulesV2.CrossingOperator.CrossingUp,
      left: { kind: RulesV2.OperandKind.Price },
      right: {
        kind: RulesV2.OperandKind.IndicatorRef,
        instanceId: 'sma-1',
        stateKey: 'value',
        valueType: StateValueType.Number,
      },
    };
    const rareCtx = buildCtx(
      fakeLookups({
        priceSeries: () => seriesOf(leftSamples),
        indicatorSeries: () => seriesOf(rareRight),
      }),
    );
    const frequentCtx = buildCtx(
      fakeLookups({
        priceSeries: () => seriesOf(leftSamples),
        indicatorSeries: () => seriesOf(frequentRight),
      }),
    );
    expect(evaluateCrossing(leaf, rareCtx)).toBe(true);
    expect(evaluateCrossing(leaf, frequentCtx)).toBe(true);
  });

  it('returns false when either series is empty / null, the latest left sits on the boundary, or no non-flat baseline exists', () => {
    const onBoundary: SeriesSample[] = [
      { ts: 100, value: 90 },
      { ts: 200, value: 100 },
    ];
    const allFlat: SeriesSample[] = [
      { ts: 100, value: 100 },
      { ts: 200, value: 100 },
      { ts: 300, value: 105 },
    ];
    const onBoundaryCtx = buildCtx(fakeLookups({ priceSeries: () => seriesOf(onBoundary) }));
    const allFlatCtx = buildCtx(fakeLookups({ priceSeries: () => seriesOf(allFlat) }));
    const emptyCtx = buildCtx(fakeLookups({ priceSeries: () => seriesOf([]) }));
    const nullCtx = buildCtx(fakeLookups({ priceSeries: () => null }));
    const leaf = priceCrossingLiteral100(RulesV2.CrossingOperator.CrossingUp);
    expect(evaluateCrossing(leaf, onBoundaryCtx)).toBe(false);
    expect(evaluateCrossing(leaf, allFlatCtx)).toBe(false);
    expect(evaluateCrossing(leaf, emptyCtx)).toBe(false);
    expect(evaluateCrossing(leaf, nullCtx)).toBe(false);
  });
});
