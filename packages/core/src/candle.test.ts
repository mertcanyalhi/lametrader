import { describe, expect, it } from 'vitest';
import {
  CandleError,
  DEFAULT_CANDLE_LIMIT,
  MAX_CANDLE_LIMIT,
  parseBackfillRange,
  parseCandleLimit,
  periodMillis,
} from './candle.js';
import { Period } from './config.types.js';

describe('parseBackfillRange', () => {
  it('returns the range for a valid finite from < to', () => {
    expect(parseBackfillRange({ from: 1000, to: 2000 })).toEqual({ from: 1000, to: 2000 });
  });

  it('returns undefined when no range is given (provider-max history)', () => {
    expect(parseBackfillRange(undefined)).toBeUndefined();
  });

  it('throws CandleError when from >= to', () => {
    expect(() => parseBackfillRange({ from: 2000, to: 2000 })).toThrow(CandleError);
  });

  it('throws CandleError when from/to is not a finite number', () => {
    expect(() => parseBackfillRange({ from: Number.NaN, to: 2000 })).toThrow(CandleError);
  });
});

describe('parseCandleLimit', () => {
  it('defaults to DEFAULT_CANDLE_LIMIT (100) when omitted', () => {
    expect(parseCandleLimit(undefined)).toBe(DEFAULT_CANDLE_LIMIT);
    expect(DEFAULT_CANDLE_LIMIT).toBe(100);
  });

  it('returns a valid in-range limit', () => {
    expect(parseCandleLimit(10)).toBe(10);
  });

  it('throws CandleError on a non-integer or < 1 value', () => {
    expect(() => parseCandleLimit(0)).toThrow(CandleError);
    expect(() => parseCandleLimit(1.5)).toThrow(CandleError);
  });

  it('throws CandleError above MAX_CANDLE_LIMIT (1000)', () => {
    expect(() => parseCandleLimit(MAX_CANDLE_LIMIT + 1)).toThrow(CandleError);
  });
});

describe('periodMillis', () => {
  it('returns the fixed duration of each period in milliseconds', () => {
    expect(periodMillis(Period.OneMinute)).toBe(60_000);
    expect(periodMillis(Period.OneDay)).toBe(86_400_000);
    expect(periodMillis(Period.OneWeek)).toBe(604_800_000);
  });
});
