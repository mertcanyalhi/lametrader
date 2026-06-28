import {
  type Candle,
  Period,
  RulesV2,
  type StateValue,
  StateValueType,
  SymbolType,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { InMemoryCandleRepository } from '../candles/in-memory-candle-repository.js';
import { IndicatorRegistry } from '../indicators/indicator-registry.js';
import { IndicatorService } from '../indicators/indicator-service.js';
import { movingAverage } from '../indicators/sma.js';
import { InMemoryWatchlistRepository } from '../symbols/in-memory-watchlist-repository.js';
import { buildEvaluationContext, prewarmBarSeries } from './evaluation-context.js';
import { IndicatorSeriesStore } from './indicator-series-store.js';
import { TickRing } from './tick-ring.js';

const SYMBOL = 'BTC';
const PERIOD = Period.OneMinute;
const PROFILE = 'profile-1';
const INSTANCE_ID = 'sma-3-inst';

const candle = (time: number, close: number): Candle => ({
  type: SymbolType.Crypto,
  time,
  open: close,
  high: close + 0.5,
  low: close - 0.5,
  close,
  volume: 100,
  quoteVolume: close * 100,
  trades: 1,
});

const seed = async () => {
  const repo = new InMemoryCandleRepository();
  const bars = [10, 20, 30].map((c, i) => candle((i + 1) * 60_000, c));
  await repo.save(SYMBOL, PERIOD, bars);

  const watchlist = new InMemoryWatchlistRepository([
    {
      id: SYMBOL,
      type: SymbolType.Crypto,
      description: 'BTC',
      exchange: 'Binance',
      periods: [PERIOD],
    },
  ]);
  const indicators = new IndicatorRegistry();
  indicators.register(movingAverage);
  const indicatorService = new IndicatorService(indicators, watchlist, repo);

  const indicatorStore = new IndicatorSeriesStore(indicatorService);
  await indicatorStore.warmup({
    instanceId: INSTANCE_ID,
    symbolId: SYMBOL,
    period: PERIOD,
    indicatorKey: 'sma',
    inputs: { length: 3, source: 'close' },
  });

  const tickRing = new TickRing();
  tickRing.push(100, 9);
  tickRing.push(200, 11);

  const symbolState: Record<string, StateValue> = {
    mode: { type: StateValueType.String, value: 'armed' },
  };
  const globalState: Record<string, StateValue> = {
    regime: { type: StateValueType.Enum, value: 'bull' },
  };

  const barWindow = { from: 0, to: 4 * 60_000 };
  const barSeries = await prewarmBarSeries(repo, SYMBOL, barWindow, [
    { period: PERIOD, axis: 'open' },
    { period: PERIOD, axis: 'high' },
    { period: PERIOD, axis: 'low' },
    { period: PERIOD, axis: 'close' },
    { period: PERIOD, axis: 'volume' },
  ]);

  const ctx = buildEvaluationContext({
    symbolId: SYMBOL,
    profileId: PROFILE,
    candleRepository: repo,
    tickRings: new Map([[SYMBOL, tickRing]]),
    indicatorStore,
    barWindow,
    barSeries,
    getSymbolState: (_profileId, sym, key) => (sym === SYMBOL ? (symbolState[key] ?? null) : null),
    getGlobalState: (_profileId, key) => globalState[key] ?? null,
  });

  return { ctx, repo, indicatorStore, tickRing };
};

describe('buildEvaluationContext', () => {
  it('resolveLatest returns the current StateValue for every operand kind', async () => {
    const { ctx } = await seed();

    const price = ctx.resolveLatest({ kind: RulesV2.OperandKind.Price });
    const open = ctx.resolveLatest({
      kind: RulesV2.OperandKind.Open,
    });
    const high = ctx.resolveLatest({
      kind: RulesV2.OperandKind.High,
    });
    const low = ctx.resolveLatest({ kind: RulesV2.OperandKind.Low });
    const close = ctx.resolveLatest({
      kind: RulesV2.OperandKind.Close,
    });
    const volume = ctx.resolveLatest({
      kind: RulesV2.OperandKind.Volume,
    });
    const indicatorRef = ctx.resolveLatest({
      kind: RulesV2.OperandKind.IndicatorRef,
      instanceId: INSTANCE_ID,
      stateKey: 'value',
      valueType: StateValueType.Number,
    });
    const symbolRef = ctx.resolveLatest({
      kind: RulesV2.OperandKind.SymbolStateRef,
      key: 'mode',
      valueType: StateValueType.String,
    });
    const globalRef = ctx.resolveLatest({
      kind: RulesV2.OperandKind.GlobalStateRef,
      key: 'regime',
      valueType: StateValueType.Enum,
    });
    const literal = ctx.resolveLatest({
      kind: RulesV2.OperandKind.Literal,
      value: { type: StateValueType.Number, value: 42 },
    });

    expect({
      price,
      open,
      high,
      low,
      close,
      volume,
      indicatorRef,
      symbolRef,
      globalRef,
      literal,
    }).toEqual({
      price: { type: StateValueType.Number, value: 11 },
      open: { type: StateValueType.Number, value: 30 },
      high: { type: StateValueType.Number, value: 30.5 },
      low: { type: StateValueType.Number, value: 29.5 },
      close: { type: StateValueType.Number, value: 30 },
      volume: { type: StateValueType.Number, value: 100 },
      // SMA(3) over [10,20,30] = 20.
      indicatorRef: { type: StateValueType.Number, value: 20 },
      symbolRef: { type: StateValueType.String, value: 'armed' },
      globalRef: { type: StateValueType.Enum, value: 'bull' },
      literal: { type: StateValueType.Number, value: 42 },
    });
  });

  it('resolveSeries returns a tick-axis series for Price with backward walk + asOf + length', async () => {
    const { ctx } = await seed();
    const series = ctx.resolveSeries({ kind: RulesV2.OperandKind.Price });
    const walked = [...series.backwardWalk()];

    expect({
      length: series.length,
      walked,
      asOfMid: series.asOf(150),
    }).toEqual({
      length: 2,
      walked: [
        { ts: 200, value: { type: StateValueType.Number, value: 11 } },
        { ts: 100, value: { type: StateValueType.Number, value: 9 } },
      ],
      asOfMid: { ts: 100, value: { type: StateValueType.Number, value: 9 } },
    });
  });

  it('resolveSeries returns a single stationary point for Literal operands', async () => {
    const { ctx } = await seed();
    const series = ctx.resolveSeries({
      kind: RulesV2.OperandKind.Literal,
      value: { type: StateValueType.Number, value: 42 },
    });
    const walked = [...series.backwardWalk()];

    expect({
      length: series.length,
      walked,
      asOfPast: series.asOf(0),
      asOfFuture: series.asOf(Number.MAX_SAFE_INTEGER),
    }).toEqual({
      length: 1,
      walked: [{ ts: 0, value: { type: StateValueType.Number, value: 42 } }],
      asOfPast: { ts: 0, value: { type: StateValueType.Number, value: 42 } },
      asOfFuture: { ts: 0, value: { type: StateValueType.Number, value: 42 } },
    });
  });
});
