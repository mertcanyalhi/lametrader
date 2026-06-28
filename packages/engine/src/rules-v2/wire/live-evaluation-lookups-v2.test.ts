import { RulesV2, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { InMemoryStateRepository } from '../../state/in-memory-state-repository.js';
import { LiveEvaluationLookupsV2 } from './live-evaluation-lookups-v2.js';

describe('LiveEvaluationLookupsV2', () => {
  describe('indicator state mirroring', () => {
    it('returns null for latestIndicator and prevIndicator on a slot that has never been recorded', () => {
      const lookups = new LiveEvaluationLookupsV2(new InMemoryStateRepository());

      expect({
        latest: lookups.latestIndicator('inst-1', 'upTrend'),
        prev: lookups.prevIndicator('inst-1', 'upTrend'),
      }).toEqual({ latest: null, prev: null });
    });

    it('sets latestIndicator to the new value on the first record of an IndicatorChanged event, keeping prev null because nothing came before', () => {
      const lookups = new LiveEvaluationLookupsV2(new InMemoryStateRepository());

      lookups.record({
        kind: RulesV2.EvaluationTriggerKind.IndicatorChanged,
        ts: 1_000,
        symbolId: 'BTC',
        instanceId: 'inst-1',
        stateKey: 'upTrend',
        prev: null,
        current: { type: StateValueType.Number, value: 42 },
      });

      expect({
        latest: lookups.latestIndicator('inst-1', 'upTrend'),
        prev: lookups.prevIndicator('inst-1', 'upTrend'),
      }).toEqual({
        latest: { type: StateValueType.Number, value: 42 },
        prev: null,
      });
    });

    it('shifts the previously latest value into prevIndicator and overwrites latestIndicator when a second IndicatorChanged event is recorded for the same instance + state key', () => {
      const lookups = new LiveEvaluationLookupsV2(new InMemoryStateRepository());

      lookups.record({
        kind: RulesV2.EvaluationTriggerKind.IndicatorChanged,
        ts: 1_000,
        symbolId: 'BTC',
        instanceId: 'inst-1',
        stateKey: 'upTrend',
        prev: null,
        current: { type: StateValueType.Number, value: 42 },
      });
      lookups.record({
        kind: RulesV2.EvaluationTriggerKind.IndicatorChanged,
        ts: 2_000,
        symbolId: 'BTC',
        instanceId: 'inst-1',
        stateKey: 'upTrend',
        prev: { type: StateValueType.Number, value: 42 },
        current: { type: StateValueType.Number, value: 50 },
      });

      expect({
        latest: lookups.latestIndicator('inst-1', 'upTrend'),
        prev: lookups.prevIndicator('inst-1', 'upTrend'),
      }).toEqual({
        latest: { type: StateValueType.Number, value: 50 },
        prev: { type: StateValueType.Number, value: 42 },
      });
    });

    it('keeps different (instanceId, stateKey) slots isolated when records arrive for distinct slots', () => {
      const lookups = new LiveEvaluationLookupsV2(new InMemoryStateRepository());

      lookups.record({
        kind: RulesV2.EvaluationTriggerKind.IndicatorChanged,
        ts: 1_000,
        symbolId: 'BTC',
        instanceId: 'inst-1',
        stateKey: 'upTrend',
        prev: null,
        current: { type: StateValueType.Bool, value: true },
      });
      lookups.record({
        kind: RulesV2.EvaluationTriggerKind.IndicatorChanged,
        ts: 1_001,
        symbolId: 'BTC',
        instanceId: 'inst-1',
        stateKey: 'level',
        prev: null,
        current: { type: StateValueType.Number, value: 100 },
      });
      lookups.record({
        kind: RulesV2.EvaluationTriggerKind.IndicatorChanged,
        ts: 1_002,
        symbolId: 'BTC',
        instanceId: 'inst-2',
        stateKey: 'upTrend',
        prev: null,
        current: { type: StateValueType.Bool, value: false },
      });

      expect({
        inst1UpTrend: lookups.latestIndicator('inst-1', 'upTrend'),
        inst1Level: lookups.latestIndicator('inst-1', 'level'),
        inst2UpTrend: lookups.latestIndicator('inst-2', 'upTrend'),
      }).toEqual({
        inst1UpTrend: { type: StateValueType.Bool, value: true },
        inst1Level: { type: StateValueType.Number, value: 100 },
        inst2UpTrend: { type: StateValueType.Bool, value: false },
      });
    });
  });

  describe('symbol state mirroring through the state repository subscription', () => {
    it('mirrors a setSymbolState write into latestSymbolState and shifts the previously latest value into prevSymbolState on a subsequent write', async () => {
      const state = new InMemoryStateRepository();
      const lookups = new LiveEvaluationLookupsV2(state);

      await state.setSymbolState(
        'p1',
        'BTC',
        'phase',
        { type: StateValueType.String, value: 'on' },
        1_000,
      );
      await state.setSymbolState(
        'p1',
        'BTC',
        'phase',
        { type: StateValueType.String, value: 'off' },
        2_000,
      );

      expect({
        latest: lookups.latestSymbolState('p1', 'BTC', 'phase'),
        prev: lookups.prevSymbolState('p1', 'BTC', 'phase'),
      }).toEqual({
        latest: { type: StateValueType.String, value: 'off' },
        prev: { type: StateValueType.String, value: 'on' },
      });
    });
  });

  describe('global state mirroring through the state repository subscription', () => {
    it('mirrors a setGlobalState write into latestGlobalState and shifts the previously latest value into prevGlobalState on a subsequent write', async () => {
      const state = new InMemoryStateRepository();
      const lookups = new LiveEvaluationLookupsV2(state);

      await state.setGlobalState(
        'p1',
        'regime',
        { type: StateValueType.Enum, value: 'bull' },
        1_000,
      );
      await state.setGlobalState(
        'p1',
        'regime',
        { type: StateValueType.Enum, value: 'bear' },
        2_000,
      );

      expect({
        latest: lookups.latestGlobalState('p1', 'regime'),
        prev: lookups.prevGlobalState('p1', 'regime'),
      }).toEqual({
        latest: { type: StateValueType.Enum, value: 'bear' },
        prev: { type: StateValueType.Enum, value: 'bull' },
      });
    });
  });
});
