import { Period, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import type { CandleEvent } from '../../candles/polling-service.types.js';
import { InMemoryStateRepository } from '../../state/in-memory-state-repository.js';
import { barSeriesKey } from '../evaluation-context.js';
import { LiveEvaluationLookups } from './live-evaluation-lookups.js';

/** A crypto candle event for `(symbolId, period)` with the given open. */
function candleEvent(symbolId: string, period: Period, open: number): CandleEvent {
  return {
    id: symbolId,
    period,
    candle: { time: 0, open, high: open + 1, low: open - 1, close: open, volume: 10 },
    final: true,
  };
}

describe('LiveEvaluationLookups.recordCandle (period-keyed)', () => {
  it('keeps a per-period open so recording a 1m candle leaves the 1h read unchanged', () => {
    const lookups = new LiveEvaluationLookups(new InMemoryStateRepository());

    lookups.recordCandle(candleEvent('BTCUSDT', Period.OneHour, 49900));
    lookups.recordCandle(candleEvent('BTCUSDT', Period.OneMinute, 50010));

    expect({
      hourOpen: lookups.getOpenValue('BTCUSDT', Period.OneHour),
      minuteOpen: lookups.getOpenValue('BTCUSDT', Period.OneMinute),
    }).toEqual({ hourOpen: 49900, minuteOpen: 50010 });
  });

  it('returns null for an unobserved period', () => {
    const lookups = new LiveEvaluationLookups(new InMemoryStateRepository());
    lookups.recordCandle(candleEvent('BTCUSDT', Period.OneMinute, 50010));

    expect(lookups.getOpenValue('BTCUSDT', Period.OneHour)).toEqual(null);
  });

  it('books one series per (period, axis) so each period resolves independently', () => {
    const lookups = new LiveEvaluationLookups(new InMemoryStateRepository());
    lookups.recordCandle(candleEvent('BTCUSDT', Period.OneHour, 49900));
    lookups.recordCandle(candleEvent('BTCUSDT', Period.OneMinute, 50010));

    const book = lookups.bookSeriesFor('BTCUSDT');

    expect({
      hourOpen: book.get(barSeriesKey(Period.OneHour, 'open'))?.asOf(Number.MAX_SAFE_INTEGER)
        ?.value,
      minuteOpen: book.get(barSeriesKey(Period.OneMinute, 'open'))?.asOf(Number.MAX_SAFE_INTEGER)
        ?.value,
    }).toEqual({
      hourOpen: { type: StateValueType.Number, value: 49900 },
      minuteOpen: { type: StateValueType.Number, value: 50010 },
    });
  });
});

describe('LiveEvaluationLookups.warmInitialState', () => {
  it('populates the per-symbol mirror so getSymbolState returns the seeded value', () => {
    const state = new InMemoryStateRepository();
    const lookups = new LiveEvaluationLookups(state);

    lookups.warmInitialState([
      {
        scope: 'symbol',
        profileId: 'profile-1',
        symbolId: 'AAPL',
        key: 'breached',
        value: { type: StateValueType.Bool, value: true },
      },
    ]);

    expect(lookups.getSymbolState('profile-1', 'AAPL', 'breached')).toEqual({
      type: StateValueType.Bool,
      value: true,
    });
  });

  it('populates the per-global mirror so getGlobalState returns the seeded value', () => {
    const state = new InMemoryStateRepository();
    const lookups = new LiveEvaluationLookups(state);

    lookups.warmInitialState([
      {
        scope: 'global',
        profileId: 'profile-1',
        key: 'regime',
        value: { type: StateValueType.Number, value: 42 },
      },
    ]);

    expect(lookups.getGlobalState('profile-1', 'regime')).toEqual({
      type: StateValueType.Number,
      value: 42,
    });
  });
});
