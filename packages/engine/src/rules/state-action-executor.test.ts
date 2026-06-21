import { ActionKind, type StateChangedEvent, StateScope, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { InMemoryStateRepository } from '../state/in-memory-state-repository.js';
import { executeStateAction } from './state-action-executor.js';

describe('executeStateAction — SetSymbolState', () => {
  it('writes the tagged value to the firing symbol and emits a stateChanged event', async () => {
    const repo = new InMemoryStateRepository();
    const events: StateChangedEvent[] = [];
    repo.onStateChanged((event) => events.push(event));

    await executeStateAction(
      {
        kind: ActionKind.SetSymbolState,
        key: 'armed',
        value: { type: StateValueType.Bool, value: true },
      },
      'AAPL',
      100,
      repo,
    );

    expect(await repo.getSymbolState('AAPL', 'armed')).toEqual({
      type: StateValueType.Bool,
      value: true,
    });
    expect(events).toEqual([
      {
        scope: { kind: StateScope.Symbol, symbolId: 'AAPL' },
        key: 'armed',
        prev: null,
        current: { type: StateValueType.Bool, value: true },
        ts: 100,
      },
    ]);
  });
});

describe('executeStateAction — RemoveSymbolState', () => {
  it('removes the key and emits a stateChanged event with prev and current=null', async () => {
    const repo = new InMemoryStateRepository();
    await repo.setSymbolState('AAPL', 'armed', { type: StateValueType.Bool, value: true }, 50);
    const events: StateChangedEvent[] = [];
    repo.onStateChanged((event) => events.push(event));

    await executeStateAction(
      { kind: ActionKind.RemoveSymbolState, key: 'armed' },
      'AAPL',
      100,
      repo,
    );

    expect(await repo.getSymbolState('AAPL', 'armed')).toBeNull();
    expect(events).toEqual([
      {
        scope: { kind: StateScope.Symbol, symbolId: 'AAPL' },
        key: 'armed',
        prev: { type: StateValueType.Bool, value: true },
        current: null,
        ts: 100,
      },
    ]);
  });
});

describe('executeStateAction — SetGlobalState', () => {
  it('writes the tagged value to the global scope', async () => {
    const repo = new InMemoryStateRepository();
    const events: StateChangedEvent[] = [];
    repo.onStateChanged((event) => events.push(event));

    await executeStateAction(
      {
        kind: ActionKind.SetGlobalState,
        key: 'regime',
        value: { type: StateValueType.Enum, value: 'risk-on' },
      },
      'AAPL',
      100,
      repo,
    );

    expect(await repo.getGlobalState('regime')).toEqual({
      type: StateValueType.Enum,
      value: 'risk-on',
    });
    expect(events).toEqual([
      {
        scope: { kind: StateScope.Global },
        key: 'regime',
        prev: null,
        current: { type: StateValueType.Enum, value: 'risk-on' },
        ts: 100,
      },
    ]);
  });
});

describe('executeStateAction — RemoveGlobalState', () => {
  it('removes the global key and emits a stateChanged event', async () => {
    const repo = new InMemoryStateRepository();
    await repo.setGlobalState('regime', { type: StateValueType.Enum, value: 'risk-on' }, 50);
    const events: StateChangedEvent[] = [];
    repo.onStateChanged((event) => events.push(event));

    await executeStateAction(
      { kind: ActionKind.RemoveGlobalState, key: 'regime' },
      'AAPL',
      100,
      repo,
    );

    expect(await repo.getGlobalState('regime')).toBeNull();
    expect(events).toEqual([
      {
        scope: { kind: StateScope.Global },
        key: 'regime',
        prev: { type: StateValueType.Enum, value: 'risk-on' },
        current: null,
        ts: 100,
      },
    ]);
  });
});
