import { BacktestExitReason } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { exitReasonLabel, formatPercent } from './backtest-format.js';

describe('formatPercent', () => {
  it('renders a positive percentage with a plus sign and two decimals', () => {
    expect(formatPercent(5)).toEqual('+5.00%');
  });

  it('renders a negative percentage with a minus sign and two decimals', () => {
    expect(formatPercent(-1.5)).toEqual('-1.50%');
  });

  it('renders zero without a sign', () => {
    expect(formatPercent(0)).toEqual('0.00%');
  });
});

describe('exitReasonLabel', () => {
  it('labels a signal exit', () => {
    expect(exitReasonLabel(BacktestExitReason.Signal)).toEqual('Signal');
  });

  it('labels a profit-target exit', () => {
    expect(exitReasonLabel(BacktestExitReason.ProfitTarget)).toEqual('Profit target');
  });

  it('labels a stop-loss exit', () => {
    expect(exitReasonLabel(BacktestExitReason.StopLoss)).toEqual('Stop loss');
  });
});
