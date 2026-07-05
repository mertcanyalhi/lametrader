import {
  type Candle,
  OperandKind,
  Period,
  type StateValue,
  StateValueType,
  SymbolType,
} from '@lametrader/core';
import { InMemoryCandleRepository } from '../../market/persistence/in-memory-candle.repository.js';
import { InMemoryWatchlistRepository } from '../../market/persistence/in-memory-watchlist.repository.js';
import { IndicatorService } from '../indicators/indicator.service.js';
import { IndicatorRegistry } from '../indicators/indicator-registry.js';
import { movingAverage } from '../indicators/sma.js';
import { buildEvaluationContext, prewarmBarSeries } from './evaluation-context.js';
import { IndicatorSeriesStore } from './indicator-series-store.js';

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

  const symbolState: Record<string, StateValue> = {
    mode: { type: StateValueType.String, value: 'armed' },
  };
  const globalState: Record<string, StateValue> = {
    regime: { type: StateValueType.String, value: 'bull' },
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
    indicatorStore,
    barWindow,
    barSeries,
    getSymbolState: (_profileId, sym, key) => (sym === SYMBOL ? (symbolState[key] ?? null) : null),
    getGlobalState: (_profileId, key) => globalState[key] ?? null,
  });

  return { ctx, repo, indicatorStore };
};

describe('buildEvaluationContext', () => {
  it('resolveLatest returns the current StateValue for every operand kind', async () => {
    const { ctx } = await seed();

    const price = ctx.resolveLatest({ kind: OperandKind.Price });
    const open = ctx.resolveLatest({ kind: OperandKind.Open }, PERIOD);
    const high = ctx.resolveLatest({ kind: OperandKind.High }, PERIOD);
    const low = ctx.resolveLatest({ kind: OperandKind.Low }, PERIOD);
    const close = ctx.resolveLatest({ kind: OperandKind.Close }, PERIOD);
    const volume = ctx.resolveLatest({ kind: OperandKind.Volume }, PERIOD);
    const indicatorRef = ctx.resolveLatest(
      {
        kind: OperandKind.IndicatorRef,
        instanceId: INSTANCE_ID,
        stateKey: 'value',
        valueType: StateValueType.Number,
      },
      PERIOD,
    );
    const symbolRef = ctx.resolveLatest({
      kind: OperandKind.SymbolStateRef,
      key: 'mode',
      valueType: StateValueType.String,
    });
    const globalRef = ctx.resolveLatest({
      kind: OperandKind.GlobalStateRef,
      key: 'regime',
      valueType: StateValueType.String,
    });
    const literal = ctx.resolveLatest({
      kind: OperandKind.Literal,
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
      // Price is the latest bar close (no tick feed) — bars [10,20,30] → 30.
      price: { type: StateValueType.Number, value: 30 },
      open: { type: StateValueType.Number, value: 30 },
      high: { type: StateValueType.Number, value: 30.5 },
      low: { type: StateValueType.Number, value: 29.5 },
      close: { type: StateValueType.Number, value: 30 },
      volume: { type: StateValueType.Number, value: 100 },
      // SMA(3) over [10,20,30] = 20.
      indicatorRef: { type: StateValueType.Number, value: 20 },
      symbolRef: { type: StateValueType.String, value: 'armed' },
      globalRef: { type: StateValueType.String, value: 'bull' },
      literal: { type: StateValueType.Number, value: 42 },
    });
  });

  it('resolveLatest of an IndicatorRef with no interval resolves to null (no period to key on)', async () => {
    const { ctx } = await seed();

    expect(
      ctx.resolveLatest({
        kind: OperandKind.IndicatorRef,
        instanceId: INSTANCE_ID,
        stateKey: 'value',
        valueType: StateValueType.Number,
      }),
    ).toBeNull();
  });

  it('resolveLatest reads the OHLCV operand at the given interval, isolating periods', async () => {
    const repo = new InMemoryCandleRepository();
    await repo.save(SYMBOL, Period.OneMinute, [candle(60_000, 30)]);
    await repo.save(SYMBOL, Period.OneHour, [candle(3_600_000, 50)]);

    const watchlist = new InMemoryWatchlistRepository([
      {
        id: SYMBOL,
        type: SymbolType.Crypto,
        description: 'BTC',
        exchange: 'Binance',
        periods: [Period.OneMinute, Period.OneHour],
      },
    ]);
    const indicators = new IndicatorRegistry();
    indicators.register(movingAverage);
    const indicatorStore = new IndicatorSeriesStore(
      new IndicatorService(indicators, watchlist, repo),
    );

    const barWindow = { from: 0, to: 4 * 3_600_000 };
    const barSeries = await prewarmBarSeries(repo, SYMBOL, barWindow, [
      { period: Period.OneMinute, axis: 'close' },
      { period: Period.OneHour, axis: 'close' },
    ]);

    const ctx = buildEvaluationContext({
      symbolId: SYMBOL,
      profileId: PROFILE,
      candleRepository: repo,
      indicatorStore,
      barWindow,
      barSeries,
      getSymbolState: () => null,
      getGlobalState: () => null,
    });

    expect({
      minuteClose: ctx.resolveLatest({ kind: OperandKind.Close }, Period.OneMinute),
      hourClose: ctx.resolveLatest({ kind: OperandKind.Close }, Period.OneHour),
      // A missing interval has no period to key on — resolves to null rather
      // than borrowing another period's bar.
      noInterval: ctx.resolveLatest({ kind: OperandKind.Close }),
    }).toEqual({
      minuteClose: { type: StateValueType.Number, value: 30 },
      hourClose: { type: StateValueType.Number, value: 50 },
      noInterval: null,
    });
  });

  it('resolveLatest falls back to the latest bar close for Price when no tick has been observed', async () => {
    const repo = new InMemoryCandleRepository();
    await repo.save(SYMBOL, PERIOD, [candle(60_000, 42)]);

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
    const indicatorStore = new IndicatorSeriesStore(
      new IndicatorService(indicators, watchlist, repo),
    );

    const barWindow = { from: 0, to: 2 * 60_000 };
    const barSeries = await prewarmBarSeries(repo, SYMBOL, barWindow, [
      { period: PERIOD, axis: 'close' },
    ]);

    const ctx = buildEvaluationContext({
      symbolId: SYMBOL,
      profileId: PROFILE,
      candleRepository: repo,
      // No tick has been observed for the symbol.
      indicatorStore,
      barWindow,
      barSeries,
      getSymbolState: () => null,
      getGlobalState: () => null,
    });

    // A bare Price leaf carries no interval; Price falls back to the latest
    // close of the only observed period.
    expect(ctx.resolveLatest({ kind: OperandKind.Price })).toEqual({
      type: StateValueType.Number,
      value: 42,
    });
  });

  it('resolveSeries returns the close-axis series for Price with backward walk + asOf + length', async () => {
    const { ctx } = await seed();
    const series = ctx.resolveSeries({ kind: OperandKind.Price });
    const walked = [...series.backwardWalk()];

    expect({
      length: series.length,
      walked,
      asOfMid: series.asOf(150_000),
    }).toEqual({
      length: 3,
      walked: [
        { ts: 180_000, value: { type: StateValueType.Number, value: 30 } },
        { ts: 120_000, value: { type: StateValueType.Number, value: 20 } },
        { ts: 60_000, value: { type: StateValueType.Number, value: 10 } },
      ],
      asOfMid: { ts: 120_000, value: { type: StateValueType.Number, value: 20 } },
    });
  });

  it('resolvePrev returns the second-newest sample for series-eligible operands and dispatches to the optional getPrev* hooks for state refs', async () => {
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

    const prevSymbolStates: Record<string, StateValue> = {
      mode: { type: StateValueType.String, value: 'disarmed' },
    };
    const prevGlobalStates: Record<string, StateValue> = {
      regime: { type: StateValueType.String, value: 'bear' },
    };

    const barWindow = { from: 0, to: 4 * 60_000 };
    const barSeries = await prewarmBarSeries(repo, SYMBOL, barWindow, [
      { period: PERIOD, axis: 'close' },
    ]);

    const ctx = buildEvaluationContext({
      symbolId: SYMBOL,
      profileId: PROFILE,
      candleRepository: repo,
      indicatorStore,
      barWindow,
      barSeries,
      getSymbolState: () => null,
      getGlobalState: () => null,
      getPrevSymbolState: (_p, sym, key) =>
        sym === SYMBOL ? (prevSymbolStates[key] ?? null) : null,
      getPrevGlobalState: (_p, key) => prevGlobalStates[key] ?? null,
    });

    const prevPrice = ctx.resolvePrev({ kind: OperandKind.Price });
    const prevClose = ctx.resolvePrev({ kind: OperandKind.Close }, PERIOD);
    const prevSymbol = ctx.resolvePrev({
      kind: OperandKind.SymbolStateRef,
      key: 'mode',
      valueType: StateValueType.String,
    });
    const prevGlobal = ctx.resolvePrev({
      kind: OperandKind.GlobalStateRef,
      key: 'regime',
      valueType: StateValueType.String,
    });
    const prevLiteral = ctx.resolvePrev({
      kind: OperandKind.Literal,
      value: { type: StateValueType.Number, value: 42 },
    });

    expect({ prevPrice, prevClose, prevSymbol, prevGlobal, prevLiteral }).toEqual({
      // Price reads the close series — prev close of [10,20,30] is 20.
      prevPrice: { type: StateValueType.Number, value: 20 },
      // Bars are [10, 20, 30] — prev close is 20.
      prevClose: { type: StateValueType.Number, value: 20 },
      prevSymbol: { type: StateValueType.String, value: 'disarmed' },
      prevGlobal: { type: StateValueType.String, value: 'bear' },
      prevLiteral: { type: StateValueType.Number, value: 42 },
    });
  });

  it('resolveSeries returns a single stationary point for Literal operands', async () => {
    const { ctx } = await seed();
    const series = ctx.resolveSeries({
      kind: OperandKind.Literal,
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
