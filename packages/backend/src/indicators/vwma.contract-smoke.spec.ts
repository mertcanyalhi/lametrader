import { type Candle, SymbolType } from '@lametrader/core';
import { IndicatorError, validateIndicatorInputs } from '../domain/indicator.js';
import { defaultIndicators } from './default-indicators.js';

/**
 * Build a crypto candle.
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

describe('signal-style indicator contract (public surface, VWMA reference)', () => {
  it('looks up VWMA, validates inputs (with enum), and computes the aligned series', () => {
    const registry = defaultIndicators();
    const vwma = registry.get('vwma');
    if (!vwma) throw new Error('expected the VWMA module to be registered');

    const inputs = validateIndicatorInputs(vwma.definition, {
      length: 3,
      multiplier: 1,
      direction: 'both',
    });
    const candles = [candle(0, 10, 10), candle(1, 10, 10), candle(2, 10, 10), candle(3, 12, 20)];
    const result = vwma.compute(inputs, candles);

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
    ]);
  });

  it('rejects an invalid enum input via IndicatorError before reaching compute', () => {
    const registry = defaultIndicators();
    const vwma = registry.get('vwma');
    if (!vwma) throw new Error('expected the VWMA module to be registered');

    expect(() =>
      validateIndicatorInputs(vwma.definition, {
        length: 3,
        multiplier: 1,
        direction: 'sideways',
      }),
    ).toThrow(IndicatorError);
  });
});
