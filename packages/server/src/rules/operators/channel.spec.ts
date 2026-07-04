import {
  type ChannelLeafCondition,
  ChannelOperator,
  LeafConditionFamily,
  OperandKind,
  StateValueType,
} from '@lametrader/core';

import type { EvaluationContext } from '../evaluation-context.types.js';
import { ArraySeriesView } from '../indicator-series-store.js';
import type { SeriesPoint, SeriesView } from '../series.types.js';
import { evaluateChannel } from './channel.js';

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
  resolveLatest: (operand) => {
    if (operand.kind === OperandKind.Literal) return operand.value;
    return null;
  },
  resolvePrev: () => null,
  resolveSeries: (operand) => {
    if (operand.kind === OperandKind.Price) return leftSeries;
    if (operand.kind === OperandKind.Literal) {
      return new ArraySeriesView([{ ts: 0, value: operand.value }]);
    }
    return EMPTY_SERIES;
  },
});

const channelLeaf = (
  operator: ChannelOperator,
  lower: number,
  upper: number,
): ChannelLeafCondition => ({
  family: LeafConditionFamily.Channel,
  operator,
  left: { kind: OperandKind.Price },
  lower: {
    kind: OperandKind.Literal,
    value: { type: StateValueType.Number, value: lower },
  },
  upper: {
    kind: OperandKind.Literal,
    value: { type: StateValueType.Number, value: upper },
  },
});

describe('evaluateChannel', () => {
  it('returns true for EnteringChannel when latest left is strictly inside the band and the most recent non-on-boundary baseline was strictly outside (with consolidation at the upper bound before entry)', () => {
    // Baseline strictly above (120), then consolidates AT the upper bound 110
    // three times, then enters strictly inside the channel at 95.
    const ctx = fakeCtx(
      seriesOf([
        [100, 120],
        [200, 110],
        [300, 110],
        [400, 110],
        [500, 95],
      ]),
    );
    expect(evaluateChannel(channelLeaf(ChannelOperator.EnteringChannel, 90, 110), ctx)).toBe(true);
  });

  it('returns true for ExitingChannel when latest left is strictly outside the band and the most recent non-on-boundary baseline was strictly inside', () => {
    const ctx = fakeCtx(
      seriesOf([
        [100, 100],
        [200, 120],
      ]),
    );
    expect(evaluateChannel(channelLeaf(ChannelOperator.ExitingChannel, 90, 110), ctx)).toBe(true);
  });

  it('returns the strict snapshot `lower < latest < upper` for InsideChannel (no historical walk)', () => {
    const insideCtx = fakeCtx(
      seriesOf([
        [100, 50],
        [200, 100],
      ]),
    );
    const onBoundaryCtx = fakeCtx(
      seriesOf([
        [100, 100],
        [200, 110],
      ]),
    );
    const outsideCtx = fakeCtx(
      seriesOf([
        [100, 100],
        [200, 120],
      ]),
    );
    expect({
      inside: evaluateChannel(channelLeaf(ChannelOperator.InsideChannel, 90, 110), insideCtx),
      onBoundary: evaluateChannel(
        channelLeaf(ChannelOperator.InsideChannel, 90, 110),
        onBoundaryCtx,
      ),
      outside: evaluateChannel(channelLeaf(ChannelOperator.InsideChannel, 90, 110), outsideCtx),
    }).toEqual({ inside: true, onBoundary: false, outside: false });
  });

  it('returns false for EnteringChannel when the left series is empty or no off-boundary baseline exists', () => {
    // All baselines sit on a boundary.
    const allBoundaryCtx = fakeCtx(
      seriesOf([
        [100, 90],
        [200, 110],
        [300, 95],
      ]),
    );
    const emptyCtx = fakeCtx(seriesOf([]));
    expect({
      allBoundary: evaluateChannel(
        channelLeaf(ChannelOperator.EnteringChannel, 90, 110),
        allBoundaryCtx,
      ),
      empty: evaluateChannel(channelLeaf(ChannelOperator.EnteringChannel, 90, 110), emptyCtx),
    }).toEqual({ allBoundary: false, empty: false });
  });
});
