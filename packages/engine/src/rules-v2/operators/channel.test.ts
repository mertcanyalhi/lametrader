import { Period, RulesV2, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { buildEvaluationContext } from '../evaluation-context.js';
import type { EvaluationLookups } from '../evaluation-context.types.js';
import type { SeriesSample, SeriesView } from '../series.types.js';
import { evaluateChannel } from './channel.js';

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

const channelLeaf = (
  operator: RulesV2.ChannelOperator,
  lower: number,
  upper: number,
): RulesV2.ChannelLeafCondition => ({
  family: RulesV2.LeafConditionFamily.Channel,
  operator,
  left: { kind: RulesV2.OperandKind.Price },
  lower: {
    kind: RulesV2.OperandKind.Literal,
    value: { type: StateValueType.Number, value: lower },
  },
  upper: {
    kind: RulesV2.OperandKind.Literal,
    value: { type: StateValueType.Number, value: upper },
  },
});

describe('evaluateChannel', () => {
  it('returns true for EnteringChannel when the latest left is inside the band and the most recent non-on-boundary baseline was strictly outside', () => {
    const samples: SeriesSample[] = [
      { ts: 100, value: 80 },
      { ts: 200, value: 95 },
    ];
    const ctx = buildCtx(fakeLookups({ priceSeries: () => seriesOf(samples) }));
    expect(
      evaluateChannel(channelLeaf(RulesV2.ChannelOperator.EnteringChannel, 90, 110), ctx),
    ).toBe(true);
  });

  it('returns true for ExitingChannel when the latest left is outside the band and the most recent non-on-boundary baseline was strictly inside', () => {
    const samples: SeriesSample[] = [
      { ts: 100, value: 100 },
      { ts: 200, value: 120 },
    ];
    const ctx = buildCtx(fakeLookups({ priceSeries: () => seriesOf(samples) }));
    expect(evaluateChannel(channelLeaf(RulesV2.ChannelOperator.ExitingChannel, 90, 110), ctx)).toBe(
      true,
    );
  });

  it('returns the snapshot `lower <= latest <= upper` for InsideChannel — no historical walk needed', () => {
    const samples: SeriesSample[] = [
      { ts: 100, value: 50 },
      { ts: 200, value: 100 },
    ];
    const insideCtx = buildCtx(fakeLookups({ priceSeries: () => seriesOf(samples) }));
    const outsideCtx = buildCtx(
      fakeLookups({
        priceSeries: () =>
          seriesOf([
            { ts: 100, value: 100 },
            { ts: 200, value: 120 },
          ]),
      }),
    );
    expect(
      evaluateChannel(channelLeaf(RulesV2.ChannelOperator.InsideChannel, 90, 110), insideCtx),
    ).toBe(true);
    expect(
      evaluateChannel(channelLeaf(RulesV2.ChannelOperator.InsideChannel, 90, 110), outsideCtx),
    ).toBe(false);
  });

  it('returns false when any series resolves to null and when no off-boundary baseline exists in the walk', () => {
    const allBoundary: SeriesSample[] = [
      { ts: 100, value: 90 },
      { ts: 200, value: 110 },
      { ts: 300, value: 95 },
    ];
    const allBoundaryCtx = buildCtx(fakeLookups({ priceSeries: () => seriesOf(allBoundary) }));
    const nullCtx = buildCtx(fakeLookups({ priceSeries: () => null }));
    expect(
      evaluateChannel(
        channelLeaf(RulesV2.ChannelOperator.EnteringChannel, 90, 110),
        allBoundaryCtx,
      ),
    ).toBe(false);
    expect(
      evaluateChannel(channelLeaf(RulesV2.ChannelOperator.EnteringChannel, 90, 110), nullCtx),
    ).toBe(false);
  });
});
