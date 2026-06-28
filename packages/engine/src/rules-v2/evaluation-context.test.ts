import { Period, RulesV2, type StateValue, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { BarAxis } from './bar-series.js';
import { buildEvaluationContext } from './evaluation-context.js';
import type { EvaluationLookups } from './evaluation-context.types.js';
import type { SeriesSample, SeriesView } from './series.types.js';

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

const tickEvent: RulesV2.EvaluationTriggerEvent = {
  kind: RulesV2.EvaluationTriggerKind.Tick,
  ts: 1_000,
  symbolId: 'BTC',
  price: 100,
};

const fakeLookups = (partial: Partial<EvaluationLookups> = {}): EvaluationLookups => ({
  latestPrice: () => null,
  latestOhlcv: () => null,
  latestIndicator: () => null,
  latestSymbolState: () => null,
  latestGlobalState: () => null,
  priceSeries: () => null,
  barSeries: () => null,
  indicatorSeries: () => null,
  ...partial,
});

describe('EvaluationContext.resolveLatest', () => {
  it('returns the latest StateValue for every operand kind from #388', () => {
    const lookups = fakeLookups({
      latestPrice: (id) => (id === 'BTC' ? 100 : null),
      latestOhlcv: (id, _period, axis) => (id === 'BTC' && axis === BarAxis.Close ? 110 : null),
      latestIndicator: (instance, key) =>
        instance === 'sma-1' && key === 'value'
          ? ({ type: StateValueType.Number, value: 105 } satisfies StateValue)
          : null,
      latestSymbolState: (profile, symbol, key) =>
        profile === 'p1' && symbol === 'BTC' && key === 'trend'
          ? ({ type: StateValueType.String, value: 'up' } satisfies StateValue)
          : null,
      latestGlobalState: (profile, key) =>
        profile === 'p1' && key === 'mode'
          ? ({ type: StateValueType.String, value: 'live' } satisfies StateValue)
          : null,
    });
    const ctx = buildEvaluationContext({
      event: tickEvent,
      profileId: 'p1',
      symbolId: 'BTC',
      lookups,
      defaultPeriod: Period.OneMinute,
    });
    expect(ctx.resolveLatest({ kind: RulesV2.OperandKind.Price })).toEqual({
      type: StateValueType.Number,
      value: 100,
    });
    expect(ctx.resolveLatest({ kind: RulesV2.OperandKind.Close })).toEqual({
      type: StateValueType.Number,
      value: 110,
    });
    expect(
      ctx.resolveLatest({
        kind: RulesV2.OperandKind.IndicatorRef,
        instanceId: 'sma-1',
        stateKey: 'value',
        valueType: StateValueType.Number,
      }),
    ).toEqual({ type: StateValueType.Number, value: 105 });
    expect(
      ctx.resolveLatest({
        kind: RulesV2.OperandKind.SymbolStateRef,
        key: 'trend',
        valueType: StateValueType.String,
      }),
    ).toEqual({ type: StateValueType.String, value: 'up' });
    expect(
      ctx.resolveLatest({
        kind: RulesV2.OperandKind.GlobalStateRef,
        key: 'mode',
        valueType: StateValueType.String,
      }),
    ).toEqual({ type: StateValueType.String, value: 'live' });
    expect(
      ctx.resolveLatest({
        kind: RulesV2.OperandKind.Literal,
        value: { type: StateValueType.Number, value: 120 },
      }),
    ).toEqual({ type: StateValueType.Number, value: 120 });
  });
});

describe('EvaluationContext.resolveSeries', () => {
  it('returns a numeric SeriesView for series-eligible operands (Price, OHLCV, IndicatorRef) and null for non-series operands (state-refs, Literal)', () => {
    const priceSamples: SeriesSample[] = [
      { ts: 100, value: 90 },
      { ts: 200, value: 100 },
    ];
    const closeSamples: SeriesSample[] = [
      { ts: 100, value: 92 },
      { ts: 200, value: 102 },
    ];
    const indicatorSamples: SeriesSample[] = [
      { ts: 100, value: 91 },
      { ts: 200, value: 101 },
    ];
    const lookups = fakeLookups({
      priceSeries: () => seriesOf(priceSamples),
      barSeries: (_id, _period, axis) => (axis === BarAxis.Close ? seriesOf(closeSamples) : null),
      indicatorSeries: () => seriesOf(indicatorSamples),
    });
    const ctx = buildEvaluationContext({
      event: tickEvent,
      profileId: 'p1',
      symbolId: 'BTC',
      lookups,
      defaultPeriod: Period.OneMinute,
    });
    expect(ctx.resolveSeries({ kind: RulesV2.OperandKind.Price })?.samples()).toEqual(priceSamples);
    expect(ctx.resolveSeries({ kind: RulesV2.OperandKind.Close })?.samples()).toEqual(closeSamples);
    expect(
      ctx
        .resolveSeries({
          kind: RulesV2.OperandKind.IndicatorRef,
          instanceId: 'sma-1',
          stateKey: 'value',
          valueType: StateValueType.Number,
        })
        ?.samples(),
    ).toEqual(indicatorSamples);
    expect(
      ctx.resolveSeries({
        kind: RulesV2.OperandKind.SymbolStateRef,
        key: 'trend',
        valueType: StateValueType.String,
      }),
    ).toBeNull();
    expect(
      ctx.resolveSeries({
        kind: RulesV2.OperandKind.GlobalStateRef,
        key: 'mode',
        valueType: StateValueType.String,
      }),
    ).toBeNull();
    expect(
      ctx.resolveSeries({
        kind: RulesV2.OperandKind.Literal,
        value: { type: StateValueType.Number, value: 120 },
      }),
    ).toBeNull();
  });
});
