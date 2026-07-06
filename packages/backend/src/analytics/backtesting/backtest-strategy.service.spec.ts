import { BacktestThresholdKind, StateValueType } from '@lametrader/core';
import {
  BacktestStrategyConflictError,
  BacktestStrategyError,
  BacktestStrategyNotFoundError,
} from '../../common/domain/backtest-strategy.js';
import { BacktestStrategyService } from './backtest-strategy.service.js';
import { InMemoryBacktestStrategyRepository } from './in-memory-backtest-strategy.repository.js';

/** Deterministic id generator: s1, s2, … */
function sequentialIds(): () => string {
  let n = 0;
  return () => `s${++n}`;
}

/** A valid create/replace input keyed to a `trend` state change. */
const input = (name: string) => ({
  name,
  entry: { signal: { key: 'trend', value: { type: StateValueType.String, value: 'up' } } },
  exit: { profitTarget: { kind: BacktestThresholdKind.Percentage, amount: 5 } },
});

/** Build a service over a fresh in-memory repo with a fixed clock + deterministic ids. */
function build(clock = { value: 1000 }) {
  const strategies = new InMemoryBacktestStrategyRepository();
  const service = new BacktestStrategyService(strategies, {
    newId: sequentialIds(),
    now: () => clock.value,
  });
  return { service, strategies };
}

describe('BacktestStrategyService', () => {
  it('creates a strategy with a generated id, timestamps, and defaulted description', async () => {
    const { service } = build();
    const created = await service.create(input('Breakout'));
    expect(created).toEqual({
      id: 's1',
      name: 'Breakout',
      description: '',
      entry: { signal: { key: 'trend', value: { type: 'string', value: 'up' } } },
      exit: { profitTarget: { kind: 'percentage', amount: 5 } },
      createdAt: 1000,
      updatedAt: 1000,
    });
  });

  it('rejects a create with a duplicate name', async () => {
    const { service } = build();
    await service.create(input('Breakout'));
    await expect(service.create(input('Breakout'))).rejects.toThrow(
      new BacktestStrategyConflictError('backtest strategy name already in use: Breakout'),
    );
  });

  it('rejects a create without an entry signal', async () => {
    const { service } = build();
    await expect(
      service.create({
        name: 'No entry',
        exit: { profitTarget: { kind: BacktestThresholdKind.Fixed, amount: 1 } },
      }),
    ).rejects.toThrow(new BacktestStrategyError('entry signal is required'));
  });

  it('rejects a create without any exit mechanism', async () => {
    const { service } = build();
    await expect(
      service.create({
        name: 'No exit',
        entry: { signal: { key: 'trend', value: { type: StateValueType.String, value: 'up' } } },
        exit: {},
      }),
    ).rejects.toThrow(new BacktestStrategyError('exit must define at least one mechanism'));
  });

  it('gets a stored strategy by id', async () => {
    const { service } = build();
    await service.create(input('Breakout'));
    expect(await service.get('s1')).toEqual({
      id: 's1',
      name: 'Breakout',
      description: '',
      entry: { signal: { key: 'trend', value: { type: 'string', value: 'up' } } },
      exit: { profitTarget: { kind: 'percentage', amount: 5 } },
      createdAt: 1000,
      updatedAt: 1000,
    });
  });

  it('throws not-found getting an unknown id', async () => {
    const { service } = build();
    await expect(service.get('ghost')).rejects.toThrow(
      new BacktestStrategyNotFoundError('backtest strategy not found: ghost'),
    );
  });

  it('replaces a strategy, preserving id and createdAt while bumping updatedAt', async () => {
    const clock = { value: 1000 };
    const { service } = build(clock);
    await service.create(input('Breakout'));
    clock.value = 2000;
    const replaced = await service.replace('s1', {
      name: 'Swing',
      description: 'slower',
      entry: { signal: { key: 'regime', value: { type: StateValueType.String, value: 'bull' } } },
      exit: { stopLoss: { kind: BacktestThresholdKind.Fixed, amount: 3 } },
    });
    expect(replaced).toEqual({
      id: 's1',
      name: 'Swing',
      description: 'slower',
      entry: { signal: { key: 'regime', value: { type: 'string', value: 'bull' } } },
      exit: { stopLoss: { kind: 'fixed', amount: 3 } },
      createdAt: 1000,
      updatedAt: 2000,
    });
  });

  it('throws not-found replacing an unknown id', async () => {
    const { service } = build();
    await expect(service.replace('ghost', input('X'))).rejects.toThrow(
      new BacktestStrategyNotFoundError('backtest strategy not found: ghost'),
    );
  });

  it('removes a stored strategy', async () => {
    const { service, strategies } = build();
    await service.create(input('Breakout'));
    await service.remove('s1');
    expect(await strategies.list()).toEqual([]);
  });

  it('throws not-found removing an unknown id', async () => {
    const { service } = build();
    await expect(service.remove('ghost')).rejects.toThrow(
      new BacktestStrategyNotFoundError('backtest strategy not found: ghost'),
    );
  });

  it('allows replacing a strategy with its own name (no self-conflict)', async () => {
    const clock = { value: 1000 };
    const { service } = build(clock);
    await service.create(input('Breakout'));
    clock.value = 2000;
    const replaced = await service.replace('s1', input('Breakout'));
    expect(replaced).toEqual({
      id: 's1',
      name: 'Breakout',
      description: '',
      entry: { signal: { key: 'trend', value: { type: 'string', value: 'up' } } },
      exit: { profitTarget: { kind: 'percentage', amount: 5 } },
      createdAt: 1000,
      updatedAt: 2000,
    });
  });

  it('lists all stored strategies', async () => {
    const { service } = build();
    const first = await service.create(input('Breakout'));
    const second = await service.create(input('Swing'));
    expect(await service.list()).toEqual([first, second]);
  });
});
