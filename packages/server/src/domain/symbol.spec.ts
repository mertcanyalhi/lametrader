import { type Instrument, Period, SymbolType } from '@lametrader/core';
import {
  assertInstrumentTypeMatchesId,
  parseSymbolPeriods,
  SymbolError,
  symbolType,
} from './symbol.js';

describe('symbolType', () => {
  it('returns the type for a canonical id', () => {
    expect(symbolType('crypto:BTCUSDT')).toBe(SymbolType.Crypto);
  });

  it('throws on a missing type prefix', () => {
    expect(() => symbolType('AAPL')).toThrow(SymbolError);
  });

  it('throws on an unknown type prefix', () => {
    expect(() => symbolType('bond:US10Y')).toThrow(SymbolError);
  });
});

describe('assertInstrumentTypeMatchesId', () => {
  const base: Omit<Instrument, 'id' | 'type'> = { description: 'x', exchange: 'NMS' };

  it('passes when the id prefix and type agree', () => {
    expect(() =>
      assertInstrumentTypeMatchesId({ ...base, id: 'crypto:BTCUSDT', type: SymbolType.Crypto }),
    ).not.toThrow();
  });

  it('throws when the id prefix and type disagree', () => {
    expect(() =>
      assertInstrumentTypeMatchesId({ ...base, id: 'crypto:BTCUSDT', type: SymbolType.Stock }),
    ).toThrow(SymbolError);
  });
});

describe('parseSymbolPeriods', () => {
  const supported = [Period.OneHour, Period.OneDay];

  it('accepts a subset of the supported periods', () => {
    expect(parseSymbolPeriods(['1h', '1d'], supported)).toEqual([Period.OneHour, Period.OneDay]);
  });

  it('throws on an empty list', () => {
    expect(() => parseSymbolPeriods([], supported)).toThrow(SymbolError);
  });

  it('throws on a duplicate period', () => {
    expect(() => parseSymbolPeriods(['1h', '1h'], supported)).toThrow(SymbolError);
  });

  it('throws on an unsupported (non-enum) period string', () => {
    expect(() => parseSymbolPeriods(['2h'], supported)).toThrow(SymbolError);
  });

  it('throws on a valid period that is not enabled in the config', () => {
    expect(() => parseSymbolPeriods(['4h'], supported)).toThrow(SymbolError);
  });
});
