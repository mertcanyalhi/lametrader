// @vitest-environment jsdom
import { Period } from '@lametrader/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getStoredBacktestPeriod,
  getStoredBacktestSymbolId,
  setStoredBacktestPeriod,
  setStoredBacktestSymbolId,
} from './backtest-selection.js';

describe('backtest-selection persistence', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('reads back a persisted symbol id', () => {
    setStoredBacktestSymbolId('crypto:BTCUSDT');
    expect(getStoredBacktestSymbolId()).toEqual('crypto:BTCUSDT');
  });

  it('returns null for the symbol id when nothing is stored', () => {
    expect(getStoredBacktestSymbolId()).toEqual(null);
  });

  it('reads back a persisted period', () => {
    setStoredBacktestPeriod(Period.OneDay);
    expect(getStoredBacktestPeriod()).toEqual(Period.OneDay);
  });

  it('returns null for the period when the stored value is not a known period', () => {
    window.localStorage.setItem('backtest-period', 'not-a-period');
    expect(getStoredBacktestPeriod()).toEqual(null);
  });

  it('keeps the backtest keys independent of the chart-page keys', () => {
    setStoredBacktestSymbolId('crypto:BTCUSDT');
    setStoredBacktestPeriod(Period.OneDay);
    expect({
      chartSymbol: window.localStorage.getItem('chart-symbol'),
      chartPeriod: window.localStorage.getItem('chart-period'),
    }).toEqual({ chartSymbol: null, chartPeriod: null });
  });
});
