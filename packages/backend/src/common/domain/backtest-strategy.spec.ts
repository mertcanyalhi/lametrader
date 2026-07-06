import { BacktestThresholdKind, StateValueType } from '@lametrader/core';
import { BacktestStrategyError, parseBacktestStrategyFields } from './backtest-strategy.js';

describe('parseBacktestStrategyFields', () => {
  it('normalizes a full input into the mutable fields with a defaulted description', () => {
    const fields = parseBacktestStrategyFields({
      name: 'Breakout',
      entry: { signal: { key: 'trend', value: { type: StateValueType.String, value: 'up' } } },
      exit: {
        signal: { key: 'trend', value: { type: StateValueType.String, value: 'down' } },
        profitTarget: { kind: BacktestThresholdKind.Percentage, amount: 5 },
        stopLoss: { kind: BacktestThresholdKind.Fixed, amount: 10 },
      },
    });
    expect(fields).toEqual({
      name: 'Breakout',
      description: '',
      entry: { signal: { key: 'trend', value: { type: 'string', value: 'up' } } },
      exit: {
        signal: { key: 'trend', value: { type: 'string', value: 'down' } },
        profitTarget: { kind: 'percentage', amount: 5 },
        stopLoss: { kind: 'fixed', amount: 10 },
      },
    });
  });

  it('carries only the exit mechanisms that are present', () => {
    const fields = parseBacktestStrategyFields({
      name: 'Target only',
      description: 'takes profit',
      entry: { signal: { key: 'armed', value: { type: StateValueType.Bool, value: true } } },
      exit: { profitTarget: { kind: BacktestThresholdKind.Fixed, amount: 25 } },
    });
    expect(fields).toEqual({
      name: 'Target only',
      description: 'takes profit',
      entry: { signal: { key: 'armed', value: { type: 'bool', value: true } } },
      exit: { profitTarget: { kind: 'fixed', amount: 25 } },
    });
  });

  it('throws when the name is blank', () => {
    expect(() =>
      parseBacktestStrategyFields({
        name: '   ',
        entry: { signal: { key: 'a', value: { type: StateValueType.Number, value: 1 } } },
        exit: { profitTarget: { kind: BacktestThresholdKind.Fixed, amount: 1 } },
      }),
    ).toThrow(new BacktestStrategyError('name must be a non-empty string'));
  });

  it('throws when the entry signal is missing', () => {
    expect(() =>
      parseBacktestStrategyFields({
        name: 'No entry',
        exit: { profitTarget: { kind: BacktestThresholdKind.Fixed, amount: 1 } },
      }),
    ).toThrow(new BacktestStrategyError('entry signal is required'));
  });

  it('throws when no exit mechanism is defined', () => {
    expect(() =>
      parseBacktestStrategyFields({
        name: 'No exit',
        entry: { signal: { key: 'a', value: { type: StateValueType.Number, value: 1 } } },
        exit: {},
      }),
    ).toThrow(new BacktestStrategyError('exit must define at least one mechanism'));
  });

  it('throws when a threshold amount is not positive', () => {
    expect(() =>
      parseBacktestStrategyFields({
        name: 'Bad amount',
        entry: { signal: { key: 'a', value: { type: StateValueType.Number, value: 1 } } },
        exit: { stopLoss: { kind: BacktestThresholdKind.Percentage, amount: 0 } },
      }),
    ).toThrow(new BacktestStrategyError('exit.stopLoss.amount must be a positive number'));
  });

  it('throws when a signal value shape does not match its declared type', () => {
    expect(() =>
      parseBacktestStrategyFields({
        name: 'Bad value',
        entry: { signal: { key: 'a', value: { type: StateValueType.Number, value: 'nope' } } },
        exit: { profitTarget: { kind: BacktestThresholdKind.Fixed, amount: 1 } },
      }),
    ).toThrow(new BacktestStrategyError('entry.signal.value.value must be a finite number'));
  });
});
