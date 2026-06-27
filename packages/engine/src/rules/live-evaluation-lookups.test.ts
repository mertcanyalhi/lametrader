import { RuleEventKind, type StateValue, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { InMemoryStateRepository } from '../state/in-memory-state-repository.js';
import { LiveEvaluationLookups } from './live-evaluation-lookups.js';

/**
 * Unit tests for {@link LiveEvaluationLookups} — the synchronous facade over
 * caches kept warm by inbound `RuleEvent`s and `state.onStateChanged`
 * notifications (#290).
 */
describe('LiveEvaluationLookups', () => {
  it('records the current open value from an OpenValueChanged event', () => {
    const lookups = new LiveEvaluationLookups(new InMemoryStateRepository());
    lookups.record({
      kind: RuleEventKind.OpenValueChanged,
      ts: 1000,
      symbolId: 'AAPL',
      prev: null,
      current: 100,
      final: false,
    });
    expect(lookups.getOpenValue('AAPL')).toEqual(100);
  });

  it('records the current quote price from a CurrentValueChanged event', () => {
    const lookups = new LiveEvaluationLookups(new InMemoryStateRepository());
    lookups.record({
      kind: RuleEventKind.CurrentValueChanged,
      ts: 1000,
      symbolId: 'AAPL',
      prev: null,
      current: 99.5,
      final: false,
    });
    expect(lookups.getCurrentValue('AAPL')).toEqual(99.5);
  });

  it('records an indicator value from an IndicatorValueChanged event', () => {
    const lookups = new LiveEvaluationLookups(new InMemoryStateRepository());
    const value: StateValue = { type: StateValueType.Number, value: 42 };
    lookups.record({
      kind: RuleEventKind.IndicatorValueChanged,
      ts: 1000,
      symbolId: 'AAPL',
      instanceId: 'sma-1',
      stateKey: 'value',
      prev: null,
      current: value,
    });
    expect(lookups.getIndicatorValue('sma-1', 'value')).toEqual(value);
  });

  it('mirrors a symbol-state write made through StateRepository.onStateChanged', async () => {
    const state = new InMemoryStateRepository();
    const lookups = new LiveEvaluationLookups(state);
    await state.setSymbolState(
      'profile-1',
      'AAPL',
      'trend',
      { type: StateValueType.Enum, value: 'up' },
      1000,
    );
    expect(lookups.getSymbolState('profile-1', 'AAPL', 'trend')).toEqual({
      type: StateValueType.Enum,
      value: 'up',
    });
  });

  it('mirrors a global-state write made through StateRepository.onStateChanged', async () => {
    const state = new InMemoryStateRepository();
    const lookups = new LiveEvaluationLookups(state);
    await state.setGlobalState(
      'profile-1',
      'regime',
      { type: StateValueType.Enum, value: 'bull' },
      1000,
    );
    expect(lookups.getGlobalState('profile-1', 'regime')).toEqual({
      type: StateValueType.Enum,
      value: 'bull',
    });
  });

  it('getCurrentValue falls back to the latest CloseValueChanged when no CurrentValueChanged has been observed', () => {
    const lookups = new LiveEvaluationLookups(new InMemoryStateRepository());
    lookups.record({
      kind: RuleEventKind.CloseValueChanged,
      ts: 1000,
      symbolId: 'AAPL',
      prev: null,
      current: 105,
      final: false,
    });
    expect(lookups.getCurrentValue('AAPL')).toEqual(105);
  });

  it('getCurrentValue prefers a CurrentValueChanged value over a CloseValueChanged fallback', () => {
    const lookups = new LiveEvaluationLookups(new InMemoryStateRepository());
    lookups.record({
      kind: RuleEventKind.CloseValueChanged,
      ts: 1000,
      symbolId: 'AAPL',
      prev: null,
      current: 105,
      final: false,
    });
    lookups.record({
      kind: RuleEventKind.CurrentValueChanged,
      ts: 1001,
      symbolId: 'AAPL',
      prev: null,
      current: 106.5,
      final: false,
    });
    expect(lookups.getCurrentValue('AAPL')).toEqual(106.5);
  });

  it('returns null for getters whose underlying slot has never been written', () => {
    const lookups = new LiveEvaluationLookups(new InMemoryStateRepository());
    expect({
      open: lookups.getOpenValue('AAPL'),
      current: lookups.getCurrentValue('AAPL'),
      indicator: lookups.getIndicatorValue('sma-1', 'value'),
      symbolState: lookups.getSymbolState('profile-1', 'AAPL', 'trend'),
      globalState: lookups.getGlobalState('profile-1', 'regime'),
    }).toEqual({
      open: null,
      current: null,
      indicator: null,
      symbolState: null,
      globalState: null,
    });
  });
});
