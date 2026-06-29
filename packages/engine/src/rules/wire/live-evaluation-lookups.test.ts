import { StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { InMemoryStateRepository } from '../../state/in-memory-state-repository.js';
import { LiveEvaluationLookups } from './live-evaluation-lookups.js';

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
