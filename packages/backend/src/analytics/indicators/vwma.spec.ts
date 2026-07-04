import { type Candle, PriceSource, SymbolType } from '@lametrader/core';
import { IndicatorError } from '../../common/domain/indicator.js';
import { defaultIndicators } from './default-indicators.js';
import { volumeWeightedMovingAverage } from './vwma.js';

/**
 * Build a crypto candle at `time` with `close` and `volume`; other OHLC values are equal to close since VWMA(Close) only reads close and volume.
 */
const candle = (time: number, close: number, volume: number): Candle => ({
  type: SymbolType.Crypto,
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume,
  quoteVolume: close * volume,
  trades: 1,
});

/**
 * Reference fixture exercising warm-up, the first computable row, an up-cross, and a down-cross.
 *
 * length=3 over [(10,10), (10,10), (10,10), (12,20), (8,20)]:
 *   - bar 0..1: warm-up → null all fields.
 *   - bar 2: VWMA = (10*10 + 10*10 + 10*10) / 30 = 10; no prev value → signal null.
 *   - bar 3: VWMA = (10*10 + 10*10 + 12*20) / 40 = 440/40 = 11; prev source 10 ≤ prev value 10 and curr source 12 > curr value 11 → up-cross → buy. Deviation = |12-11|/11.
 *   - bar 4: VWMA = (10*10 + 12*20 + 8*20) / 50 = 500/50 = 10; prev source 12 ≥ prev value 11 and curr source 8 < curr value 10 → down-cross → sell (when direction = both). Deviation = |8-10|/10 = 0.2.
 */
const candles: Candle[] = [
  candle(0, 10, 10),
  candle(1, 10, 10),
  candle(2, 10, 10),
  candle(3, 12, 20),
  candle(4, 8, 20),
];

describe('volumeWeightedMovingAverage.compute', () => {
  it('returns the expected aligned series in direction=both mode', () => {
    const result = volumeWeightedMovingAverage.compute(
      { length: 3, source: PriceSource.Close, multiplier: 1, direction: 'both' },
      candles,
    );
    expect(result).toEqual([
      { time: 0, value: null, signal: null, confidence: null },
      { time: 1, value: null, signal: null, confidence: null },
      { time: 2, value: expect.closeTo(10, 6), signal: null, confidence: null },
      {
        time: 3,
        value: expect.closeTo(11, 6),
        signal: 'buy',
        confidence: expect.closeTo(1 / 11, 6),
      },
      {
        time: 4,
        value: expect.closeTo(10, 6),
        signal: 'sell',
        confidence: expect.closeTo(0.2, 6),
      },
    ]);
  });

  it('suppresses sell signals in direction=long-only mode', () => {
    const result = volumeWeightedMovingAverage.compute(
      { length: 3, source: PriceSource.Close, multiplier: 1, direction: 'long-only' },
      candles,
    );
    // The buy bar still fires; the sell bar's signal/confidence go null.
    expect(result[3]).toEqual({
      time: 3,
      value: expect.closeTo(11, 6),
      signal: 'buy',
      confidence: expect.closeTo(1 / 11, 6),
    });
    expect(result[4]).toEqual({
      time: 4,
      value: expect.closeTo(10, 6),
      signal: null,
      confidence: null,
    });
  });

  it('does not use look-ahead: the truncated prefix equals the full series prefix at the buy bar', () => {
    const full = volumeWeightedMovingAverage.compute(
      { length: 3, source: PriceSource.Close, multiplier: 1, direction: 'both' },
      candles,
    );
    const truncated = volumeWeightedMovingAverage.compute(
      { length: 3, source: PriceSource.Close, multiplier: 1, direction: 'both' },
      candles.slice(0, 4),
    );
    expect(truncated).toEqual(full.slice(0, 4));
  });

  it('returns an all-null series when the input is shorter than length (silent)', () => {
    expect(
      volumeWeightedMovingAverage.compute(
        { length: 5, source: PriceSource.Close, multiplier: 1, direction: 'both' },
        candles.slice(0, 2),
      ),
    ).toEqual([
      { time: 0, value: null, signal: null, confidence: null },
      { time: 1, value: null, signal: null, confidence: null },
    ]);
  });

  it('throws IndicatorError when handed an FX candle (defensive backstop on top of appliesTo)', () => {
    const fxCandles: Candle[] = [
      { type: SymbolType.Fx, time: 0, open: 1, high: 1, low: 1, close: 1 },
      { type: SymbolType.Fx, time: 1, open: 1, high: 1, low: 1, close: 1 },
      { type: SymbolType.Fx, time: 2, open: 1, high: 1, low: 1, close: 1 },
    ];
    expect(() =>
      volumeWeightedMovingAverage.compute(
        { length: 3, source: PriceSource.Close, multiplier: 1, direction: 'both' },
        fxCandles,
      ),
    ).toThrow(IndicatorError);
  });
});

describe('volumeWeightedMovingAverage.definition', () => {
  it('narrows appliesTo to volume-bearing classes only', () => {
    expect(volumeWeightedMovingAverage.definition.appliesTo).toEqual([
      SymbolType.Crypto,
      SymbolType.Stock,
      SymbolType.Fund,
    ]);
  });

  it('is JSON-serializable (no functions leak into the metadata)', () => {
    const roundTripped = JSON.parse(JSON.stringify(volumeWeightedMovingAverage.definition));
    expect(roundTripped).toEqual(volumeWeightedMovingAverage.definition);
  });
});

describe('defaultIndicators (with VWMA registered)', () => {
  it('now contains both sma and vwma definitions', () => {
    const registry = defaultIndicators();
    expect(
      registry
        .list()
        .map((d) => d.key)
        .sort(),
    ).toEqual(['sma', 'vwma']);
    expect(registry.get('vwma')).toEqual(volumeWeightedMovingAverage);
  });
});

describe('volumeWeightedMovingAverage.warmup', () => {
  it('returns `length` bars — the count the compute service needs before the first non-null row', () => {
    expect(
      volumeWeightedMovingAverage.warmup?.({
        length: 20,
        source: PriceSource.Close,
        multiplier: 1,
        direction: 'both',
      }),
    ).toEqual(20);
  });
});
