import { describe, expect, it } from 'vitest';
import { Period, parseSymbolPeriods, SymbolError, SymbolType, symbolType } from './index.js';

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
