import {
  type Candle,
  OperandKind,
  Period,
  type StateValue,
  StateValueType,
  SymbolType,
} from '@lametrader/core';
import {
  type BarAxis,
  buildEvaluationContext,
  IndicatorRegistry,
  IndicatorSeriesStore,
  IndicatorService,
  InMemoryCandleRepository,
  InMemoryWatchlistRepository,
  movingAverage,
  prewarmBarSeries,
  TickRing,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';

const SYMBOL = 'crypto:BTCUSDT';
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

describe('rules series store + EvaluationContext (e2e)', () => {
  it('drives the full stack — seeded candles, indicator warmup, fresh bar + ticks — and resolves every operand kind end-to-end', async () => {
    // ── Seed: 10 deterministic candles + watch symbol + indicator registry ──
    const repo = new InMemoryCandleRepository();
    const closes = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28];
    const seeded = closes.map((c, i) => candle((i + 1) * 60_000, c));
    await repo.save(SYMBOL, PERIOD, seeded);

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

    // ── Warm up the indicator series store from candle history ──
    const indicatorStore = new IndicatorSeriesStore(indicatorService);
    await indicatorStore.warmup({
      instanceId: INSTANCE_ID,
      symbolId: SYMBOL,
      period: PERIOD,
      indicatorKey: 'sma',
      inputs: { length: 3, source: 'close' },
    });

    // ── Push one fresh bar through onBar ──
    const newBar = candle(11 * 60_000, 30);
    await repo.save(SYMBOL, PERIOD, [newBar]);
    await indicatorStore.onBar(INSTANCE_ID, newBar);

    // ── Push a few ticks into the tick ring ──
    const tickRing = new TickRing();
    tickRing.push(11 * 60_000 + 1, 29.8);
    tickRing.push(11 * 60_000 + 500, 30.1);
    tickRing.push(11 * 60_000 + 1000, 30.4);

    // ── Build the EvaluationContext + pre-warm bar series ──
    const barWindow = { from: 0, to: 12 * 60_000 };
    const required: ReadonlyArray<{ period: Period; axis: BarAxis }> = [
      { period: PERIOD, axis: 'open' },
      { period: PERIOD, axis: 'high' },
      { period: PERIOD, axis: 'low' },
      { period: PERIOD, axis: 'close' },
      { period: PERIOD, axis: 'volume' },
    ];
    const barSeries = await prewarmBarSeries(repo, SYMBOL, barWindow, required);

    const symbolState: Record<string, StateValue> = {
      mode: { type: StateValueType.String, value: 'armed' },
    };
    const globalState: Record<string, StateValue> = {
      regime: { type: StateValueType.String, value: 'bull' },
    };

    const ctx = buildEvaluationContext({
      symbolId: SYMBOL,
      profileId: PROFILE,
      candleRepository: repo,
      tickRings: new Map([[SYMBOL, tickRing]]),
      indicatorStore,
      barWindow,
      barSeries,
      getSymbolState: (_p, sym, key) => (sym === SYMBOL ? (symbolState[key] ?? null) : null),
      getGlobalState: (_p, key) => globalState[key] ?? null,
    });

    // ── Assert: resolveLatest for every operand kind ──
    expect({
      price: ctx.resolveLatest({ kind: OperandKind.Price }),
      close: ctx.resolveLatest({ kind: OperandKind.Close }, PERIOD),
      high: ctx.resolveLatest({ kind: OperandKind.High }, PERIOD),
      indicator: ctx.resolveLatest({
        kind: OperandKind.IndicatorRef,
        instanceId: INSTANCE_ID,
        stateKey: 'value',
        valueType: StateValueType.Number,
      }),
      symbol: ctx.resolveLatest({
        kind: OperandKind.SymbolStateRef,
        key: 'mode',
        valueType: StateValueType.String,
      }),
      global: ctx.resolveLatest({
        kind: OperandKind.GlobalStateRef,
        key: 'regime',
        valueType: StateValueType.String,
      }),
      literal: ctx.resolveLatest({
        kind: OperandKind.Literal,
        value: { type: StateValueType.Number, value: 99 },
      }),
    }).toEqual({
      price: { type: StateValueType.Number, value: 30.4 },
      close: { type: StateValueType.Number, value: 30 },
      high: { type: StateValueType.Number, value: 30.5 },
      // SMA(3) over [..., 28, 30] = mean(26, 28, 30) = 28.
      indicator: { type: StateValueType.Number, value: 28 },
      symbol: { type: StateValueType.String, value: 'armed' },
      global: { type: StateValueType.String, value: 'bull' },
      literal: { type: StateValueType.Number, value: 99 },
    });

    // ── Assert: resolveSeries(Price).asOf returns the right-operand resample ──
    const priceSeries = ctx.resolveSeries({ kind: OperandKind.Price });
    expect({
      length: priceSeries.length,
      asOfMid: priceSeries.asOf(11 * 60_000 + 600),
    }).toEqual({
      length: 3,
      asOfMid: {
        ts: 11 * 60_000 + 500,
        value: { type: StateValueType.Number, value: 30.1 },
      },
    });
  });

  it('returns an empty series for an unwatched symbol — operators see length 0 rather than crashing', async () => {
    const repo = new InMemoryCandleRepository();
    const watchlist = new InMemoryWatchlistRepository([]);
    const indicators = new IndicatorRegistry();
    indicators.register(movingAverage);
    const indicatorService = new IndicatorService(indicators, watchlist, repo);
    const indicatorStore = new IndicatorSeriesStore(indicatorService);

    const ctx = buildEvaluationContext({
      symbolId: 'crypto:UNKNOWN',
      profileId: PROFILE,
      candleRepository: repo,
      tickRings: new Map(),
      indicatorStore,
      barWindow: { from: 0, to: 60_000 },
      getSymbolState: () => null,
      getGlobalState: () => null,
    });

    const priceSeries = ctx.resolveSeries({ kind: OperandKind.Price });
    const closeLatest = ctx.resolveLatest({ kind: OperandKind.Close }, PERIOD);

    expect({
      priceLength: priceSeries.length,
      priceAsOf: priceSeries.asOf(123),
      closeLatest,
    }).toEqual({
      priceLength: 0,
      priceAsOf: null,
      closeLatest: null,
    });
  });
});
