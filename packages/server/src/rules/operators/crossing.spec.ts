import {
  type CrossingLeafCondition,
  CrossingOperator,
  LeafConditionFamily,
  OperandKind,
  type StateValue,
  StateValueType,
} from '@lametrader/core';

import type { EvaluationContext } from '../evaluation-context.types.js';
import { ArraySeriesView } from '../indicator-series-store.js';
import type { SeriesPoint, SeriesView } from '../series.types.js';
import { evaluateCrossing } from './crossing.js';

const EMPTY_SERIES: SeriesView = new ArraySeriesView([]);

/** Wrap raw `(ts, value)` pairs as a numeric {@link SeriesView}. */
const seriesOf = (samples: Array<[number, number]>): SeriesView => {
  const points: SeriesPoint[] = samples.map(([ts, value]) => ({
    ts,
    value: { type: StateValueType.Number, value },
  }));
  return new ArraySeriesView(points);
};

/**
 * Minimal {@link EvaluationContext} keyed by operand kind.
 * Series-aware operators read `resolveSeries`; the snapshot path also reads
 * `resolveLatest` to derive the literal/constant right.
 */
const fakeCtx = (overrides: {
  priceSeries?: SeriesView;
  rightSeries?: SeriesView;
  rightLatest?: StateValue;
}): EvaluationContext => ({
  symbolId: 'BTC',
  resolveLatest: (operand) => {
    if (operand.kind === OperandKind.Literal) return operand.value;
    if (overrides.rightLatest && operand.kind !== OperandKind.Price) return overrides.rightLatest;
    return null;
  },
  resolvePrev: () => null,
  resolveSeries: (operand) => {
    if (operand.kind === OperandKind.Price) return overrides.priceSeries ?? EMPTY_SERIES;
    if (operand.kind === OperandKind.Literal) {
      return new ArraySeriesView([{ ts: 0, value: operand.value }]);
    }
    return overrides.rightSeries ?? EMPTY_SERIES;
  },
});

const priceCrossingLiteral100 = (operator: CrossingOperator): CrossingLeafCondition => ({
  family: LeafConditionFamily.Crossing,
  operator,
  left: { kind: OperandKind.Price },
  right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 100 } },
});

const priceCrossingIndicator = (operator: CrossingOperator): CrossingLeafCondition => ({
  family: LeafConditionFamily.Crossing,
  operator,
  left: { kind: OperandKind.Price },
  right: {
    kind: OperandKind.IndicatorRef,
    instanceId: 'sma-1',
    stateKey: 'value',
    valueType: StateValueType.Number,
  },
});

describe('evaluateCrossing', () => {
  it('returns true for CrossingUp when the latest left strictly exceeds the right and the most recent non-flat baseline (asOf-resampled) was strictly below', () => {
    const ctx = fakeCtx({
      priceSeries: seriesOf([
        [100, 90],
        [200, 95],
        [300, 105],
      ]),
    });
    expect(evaluateCrossing(priceCrossingLiteral100(CrossingOperator.CrossingUp), ctx)).toBe(true);
  });

  it('skips historical points where left === right (lookback-past-flats) — consolidation at the threshold followed by a transit fires Crossing on a fixture with three consecutive boundary samples', () => {
    const ctx = fakeCtx({
      priceSeries: seriesOf([
        [100, 90],
        [200, 100],
        [300, 100],
        [400, 100],
        [500, 105],
      ]),
    });
    expect(evaluateCrossing(priceCrossingLiteral100(CrossingOperator.Crossing), ctx)).toBe(true);
  });

  it('produces the same verdict for cross-frequency (rare vs frequent right updates) — asOf resampling decouples cadence from result', () => {
    const leftSeries = seriesOf([
      [100, 90],
      [200, 95],
      [300, 105],
    ]);
    const rareRight = seriesOf([[50, 100]]);
    const frequentRight = seriesOf([
      [50, 100],
      [110, 100],
      [170, 100],
      [220, 100],
      [290, 100],
    ]);
    const rareCtx = fakeCtx({ priceSeries: leftSeries, rightSeries: rareRight });
    const frequentCtx = fakeCtx({ priceSeries: leftSeries, rightSeries: frequentRight });
    const leaf = priceCrossingIndicator(CrossingOperator.CrossingUp);
    expect({
      rare: evaluateCrossing(leaf, rareCtx),
      frequent: evaluateCrossing(leaf, frequentCtx),
    }).toEqual({ rare: true, frequent: true });
  });

  it('returns false when the left series is empty, the latest left sits on the boundary, or no non-flat baseline exists', () => {
    const onBoundaryCtx = fakeCtx({
      priceSeries: seriesOf([
        [100, 90],
        [200, 100],
      ]),
    });
    const allFlatCtx = fakeCtx({
      priceSeries: seriesOf([
        [100, 100],
        [200, 100],
        [300, 105],
      ]),
    });
    const emptyCtx = fakeCtx({ priceSeries: seriesOf([]) });
    const leaf = priceCrossingLiteral100(CrossingOperator.CrossingUp);
    expect({
      onBoundary: evaluateCrossing(leaf, onBoundaryCtx),
      allFlat: evaluateCrossing(leaf, allFlatCtx),
      empty: evaluateCrossing(leaf, emptyCtx),
    }).toEqual({ onBoundary: false, allFlat: false, empty: false });
  });
});
