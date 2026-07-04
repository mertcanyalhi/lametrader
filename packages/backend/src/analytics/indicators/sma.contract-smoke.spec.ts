import { type Candle, SymbolType } from '@lametrader/core';
import { IndicatorError, validateIndicatorInputs } from '../../common/domain/indicator.js';
import { defaultIndicators } from './default-indicators.js';

/** Build a minimal crypto candle. */
const candle = (time: number, close: number): Candle => ({
  type: SymbolType.Crypto,
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 0,
  quoteVolume: 0,
  trades: 0,
});

/**
 * Smoke test exercising the full public surface of the indicator contract:
 * lookup via the default registry, input validation, then compute.
 */
describe('indicator contract (public surface, SMA reference)', () => {
  it('looks up SMA, validates inputs, and computes the aligned series', () => {
    const registry = defaultIndicators();
    const sma = registry.get('sma');
    if (!sma) throw new Error('expected the moving-average module to be registered');

    const inputs = validateIndicatorInputs(sma.definition, { length: 3 });
    const candles = [10, 20, 30, 40].map((close, i) => candle(i, close));
    const result = sma.compute(inputs, candles);

    expect(result).toEqual([
      { time: 0, value: null },
      { time: 1, value: null },
      { time: 2, value: expect.closeTo(20, 6) },
      { time: 3, value: expect.closeTo(30, 6) },
    ]);
  });

  it('rejects invalid inputs via IndicatorError before reaching compute', () => {
    const registry = defaultIndicators();
    const sma = registry.get('sma');
    if (!sma) throw new Error('expected the moving-average module to be registered');

    expect(() => validateIndicatorInputs(sma.definition, { length: 0 })).toThrow(IndicatorError);
  });
});
