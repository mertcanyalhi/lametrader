import {
  LeafConditionFamily,
  type MovingLeafCondition,
  MovingOperator,
  OperandKind,
  StateValueType,
} from '@lametrader/core';

import type { EvaluationContext } from '../evaluation-context.types.js';
import { ArraySeriesView } from '../indicator-series-store.js';
import type { SeriesPoint, SeriesView } from '../series.types.js';
import { evaluateMoving } from './moving.js';

const EMPTY_SERIES: SeriesView = new ArraySeriesView([]);

/** Wrap raw `(ts, value)` pairs as a numeric {@link SeriesView}. */
const seriesOf = (samples: Array<[number, number]>): SeriesView => {
  const points: SeriesPoint[] = samples.map(([ts, value]) => ({
    ts,
    value: { type: StateValueType.Number, value },
  }));
  return new ArraySeriesView(points);
};

const fakeCtx = (leftSeries: SeriesView): EvaluationContext => ({
  symbolId: 'BTC',
  resolveLatest: () => null,
  resolvePrev: () => null,
  resolveSeries: (operand) => (operand.kind === OperandKind.Price ? leftSeries : EMPTY_SERIES),
});

const movingLeaf = (
  operator: MovingOperator,
  threshold: number,
  lookbackBars: number,
): MovingLeafCondition => ({
  family: LeafConditionFamily.Moving,
  operator,
  left: { kind: OperandKind.Price },
  threshold,
  lookbackBars,
});

describe('evaluateMoving', () => {
  it('returns true for MovingUp when current - past (3 bars back) >= absolute threshold', () => {
    const ctx = fakeCtx(
      seriesOf([
        [100, 90],
        [200, 95],
        [300, 100],
        [400, 110],
      ]),
    );
    expect(evaluateMoving(movingLeaf(MovingOperator.MovingUp, 10, 3), ctx)).toBe(true);
  });

  it('returns true for MovingDownPercent when (past - current) / past * 100 >= threshold, and false when past is 0 (no divide-by-zero)', () => {
    const downCtx = fakeCtx(
      seriesOf([
        [100, 100],
        [200, 90],
      ]),
    );
    const zeroPastCtx = fakeCtx(
      seriesOf([
        [100, 0],
        [200, -5],
      ]),
    );
    expect({
      down: evaluateMoving(movingLeaf(MovingOperator.MovingDownPercent, 10, 1), downCtx),
      zeroPast: evaluateMoving(movingLeaf(MovingOperator.MovingDownPercent, 10, 1), zeroPastCtx),
    }).toEqual({ down: true, zeroPast: false });
  });

  it('returns false when the series has fewer than lookbackBars + 1 samples', () => {
    const shortCtx = fakeCtx(
      seriesOf([
        [100, 90],
        [200, 100],
      ]),
    );
    const emptyCtx = fakeCtx(seriesOf([]));
    expect({
      short: evaluateMoving(movingLeaf(MovingOperator.MovingUp, 5, 3), shortCtx),
      empty: evaluateMoving(movingLeaf(MovingOperator.MovingUp, 5, 3), emptyCtx),
    }).toEqual({ short: false, empty: false });
  });
});
