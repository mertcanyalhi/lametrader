import { Period, RulesV2 } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { buildEvaluationContext } from '../evaluation-context.js';
import type { EvaluationLookups } from '../evaluation-context.types.js';
import type { SeriesSample, SeriesView } from '../series.types.js';
import { evaluateMoving } from './moving.js';

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

const movingLeaf = (
  operator: RulesV2.MovingOperator,
  threshold: number,
  lookbackBars: number,
): RulesV2.MovingLeafCondition => ({
  family: RulesV2.LeafConditionFamily.Moving,
  operator,
  left: { kind: RulesV2.OperandKind.Price },
  threshold,
  lookbackBars,
});

describe('evaluateMoving', () => {
  it('returns true for MovingUp when current.value - past.value (3 bars back) >= absolute threshold', () => {
    const samples: SeriesSample[] = [
      { ts: 100, value: 90 },
      { ts: 200, value: 95 },
      { ts: 300, value: 100 },
      { ts: 400, value: 110 },
    ];
    const ctx = buildCtx(fakeLookups({ priceSeries: () => seriesOf(samples) }));
    expect(evaluateMoving(movingLeaf(RulesV2.MovingOperator.MovingUp, 10, 3), ctx)).toBe(true);
  });

  it('returns true for MovingDownPercent when (past.value - current.value) / past.value * 100 >= threshold and false when past.value is 0', () => {
    const downSamples: SeriesSample[] = [
      { ts: 100, value: 100 },
      { ts: 200, value: 90 },
    ];
    const zeroPastSamples: SeriesSample[] = [
      { ts: 100, value: 0 },
      { ts: 200, value: -5 },
    ];
    const downCtx = buildCtx(fakeLookups({ priceSeries: () => seriesOf(downSamples) }));
    const zeroPastCtx = buildCtx(fakeLookups({ priceSeries: () => seriesOf(zeroPastSamples) }));
    expect(
      evaluateMoving(movingLeaf(RulesV2.MovingOperator.MovingDownPercent, 10, 1), downCtx),
    ).toBe(true);
    expect(
      evaluateMoving(movingLeaf(RulesV2.MovingOperator.MovingDownPercent, 10, 1), zeroPastCtx),
    ).toBe(false);
  });

  it('returns false when the series has fewer than lookbackBars + 1 samples or resolveSeries returns null', () => {
    const shortSamples: SeriesSample[] = [
      { ts: 100, value: 90 },
      { ts: 200, value: 100 },
    ];
    const shortCtx = buildCtx(fakeLookups({ priceSeries: () => seriesOf(shortSamples) }));
    const nullCtx = buildCtx(fakeLookups({ priceSeries: () => null }));
    expect(evaluateMoving(movingLeaf(RulesV2.MovingOperator.MovingUp, 5, 3), shortCtx)).toBe(false);
    expect(evaluateMoving(movingLeaf(RulesV2.MovingOperator.MovingUp, 5, 3), nullCtx)).toBe(false);
  });
});
