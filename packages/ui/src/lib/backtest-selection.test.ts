// @vitest-environment jsdom
import { Period } from '@lametrader/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getStoredBacktestPeriod,
  getStoredBacktestStrategyId,
  getStoredBacktestSymbolId,
  getStoredBacktestWindow,
  setStoredBacktestPeriod,
  setStoredBacktestStrategyId,
  setStoredBacktestSymbolId,
  setStoredBacktestWindow,
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

  it('reads back a persisted run window', () => {
    setStoredBacktestWindow({ from: 1_000, to: 2_000 });
    expect(getStoredBacktestWindow()).toEqual({ from: 1_000, to: 2_000 });
  });

  it('returns null for the run window when nothing is stored', () => {
    expect(getStoredBacktestWindow()).toEqual(null);
  });

  it('returns null for the run window when the stored value is malformed', () => {
    window.localStorage.setItem('backtest-window', '{"from":5}');
    expect(getStoredBacktestWindow()).toEqual(null);
  });

  it('returns null for the run window when from is not before to', () => {
    window.localStorage.setItem('backtest-window', '{"from":2000,"to":1000}');
    expect(getStoredBacktestWindow()).toEqual(null);
  });

  it('reads back a persisted strategy id', () => {
    setStoredBacktestStrategyId('s-1');
    expect(getStoredBacktestStrategyId()).toEqual('s-1');
  });

  it('returns null for the strategy id when nothing is stored', () => {
    expect(getStoredBacktestStrategyId()).toEqual(null);
  });

  it('clears the persisted strategy id when set to null', () => {
    setStoredBacktestStrategyId('s-1');
    setStoredBacktestStrategyId(null);
    expect(getStoredBacktestStrategyId()).toEqual(null);
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
