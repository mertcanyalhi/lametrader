import { describe, expect, it } from 'vitest';
import type { Candle } from './candle.types.js';
import {
  FieldType,
  IndicatorError,
  type NumberFieldDescriptor,
  PriceSource,
  resolveSource,
  type SourceFieldDescriptor,
  validateIndicatorInputs,
} from './indicator.js';
import { SymbolType } from './symbol.types.js';

/** A reference set of input descriptors used across validation tests. */
const lengthDescriptor: NumberFieldDescriptor = {
  type: FieldType.Number,
  key: 'length',
  label: 'Length',
  integer: true,
  min: 1,
  max: 100,
  default: 14,
};
const sourceDescriptor: SourceFieldDescriptor = {
  type: FieldType.Source,
  key: 'source',
  label: 'Source',
  default: PriceSource.Close,
};

/** A crypto candle fixture for resolveSource tests. */
const cryptoCandle: Candle = {
  type: SymbolType.Crypto,
  time: 1_000,
  open: 10,
  high: 20,
  low: 5,
  close: 15,
  volume: 100,
  quoteVolume: 1_500,
  trades: 3,
};

/** An equity candle (carries volume). */
const equityCandle: Candle = {
  type: SymbolType.Stock,
  time: 1_000,
  open: 10,
  high: 20,
  low: 5,
  close: 15,
  volume: 200,
};

/** An FX candle (no volume). */
const fxCandle: Candle = {
  type: SymbolType.Fx,
  time: 1_000,
  open: 1.1,
  high: 1.2,
  low: 1.0,
  close: 1.15,
};

describe('validateIndicatorInputs', () => {
  it('returns a typed object when all inputs are valid', () => {
    expect(
      validateIndicatorInputs(
        { inputs: [lengthDescriptor, sourceDescriptor] },
        {
          length: 14,
          source: PriceSource.Close,
        },
      ),
    ).toEqual({ length: 14, source: PriceSource.Close });
  });

  it("applies a number input's default when the value is omitted", () => {
    expect(
      validateIndicatorInputs(
        { inputs: [lengthDescriptor, sourceDescriptor] },
        {
          source: PriceSource.Close,
        },
      ),
    ).toEqual({ length: 14, source: PriceSource.Close });
  });

  it('rejects a number outside [min, max] or non-integer when integer: true', () => {
    expect(() => validateIndicatorInputs({ inputs: [lengthDescriptor] }, { length: 0 })).toThrow(
      IndicatorError,
    );
    expect(() => validateIndicatorInputs({ inputs: [lengthDescriptor] }, { length: 101 })).toThrow(
      IndicatorError,
    );
    expect(() => validateIndicatorInputs({ inputs: [lengthDescriptor] }, { length: 1.5 })).toThrow(
      IndicatorError,
    );
  });

  it("rejects a source value that isn't a member of PriceSource", () => {
    expect(() =>
      validateIndicatorInputs({ inputs: [sourceDescriptor] }, { source: 'nope' }),
    ).toThrow(IndicatorError);
  });

  it('rejects a required value with no default and no input', () => {
    const required: NumberFieldDescriptor = {
      type: FieldType.Number,
      key: 'multiplier',
      label: 'Multiplier',
    };
    expect(() => validateIndicatorInputs({ inputs: [required] }, {})).toThrow(IndicatorError);
  });
});

describe('resolveSource', () => {
  it('returns the correct numeric for each selector against a crypto candle', () => {
    expect(resolveSource(cryptoCandle, PriceSource.Open)).toEqual(10);
    expect(resolveSource(cryptoCandle, PriceSource.High)).toEqual(20);
    expect(resolveSource(cryptoCandle, PriceSource.Low)).toEqual(5);
    expect(resolveSource(cryptoCandle, PriceSource.Close)).toEqual(15);
    expect(resolveSource(cryptoCandle, PriceSource.HL2)).toEqual(expect.closeTo(12.5, 6));
    expect(resolveSource(cryptoCandle, PriceSource.HLC3)).toEqual(
      expect.closeTo((20 + 5 + 15) / 3, 6),
    );
    expect(resolveSource(cryptoCandle, PriceSource.OHLC4)).toEqual(
      expect.closeTo((10 + 20 + 5 + 15) / 4, 6),
    );
  });

  it('returns volume for crypto and equity candles; rejects Volume on FX', () => {
    expect(resolveSource(cryptoCandle, PriceSource.Volume)).toEqual(100);
    expect(resolveSource(equityCandle, PriceSource.Volume)).toEqual(200);
    expect(() => resolveSource(fxCandle, PriceSource.Volume)).toThrow(IndicatorError);
  });
});
