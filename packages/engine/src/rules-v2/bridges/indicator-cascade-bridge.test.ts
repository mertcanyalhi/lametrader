import { type IndicatorStateEvent, Period, RulesV2, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { IndicatorCascadeBridge } from './indicator-cascade-bridge.js';

/** Build a complete `IndicatorStateEvent` from a few overrides. */
function stateEvent(overrides: {
  subscriptionId?: string;
  id?: string;
  period?: Period;
  indicatorKey?: string;
  state: Record<string, unknown> & { time: number };
  final?: boolean;
}): IndicatorStateEvent {
  return {
    subscriptionId: overrides.subscriptionId ?? 'sub-1',
    id: overrides.id ?? 'AAPL',
    period: overrides.period ?? Period.OneMinute,
    indicatorKey: overrides.indicatorKey ?? 'sma',
    state: overrides.state,
    final: overrides.final ?? false,
  };
}

describe('IndicatorCascadeBridge', () => {
  it('ignores events whose subscriptionId has not been bound to an indicator instance', () => {
    const events: RulesV2.EvaluationTriggerEvent[] = [];
    const bridge = new IndicatorCascadeBridge((event) => events.push(event));
    bridge.handleIndicatorState(
      stateEvent({ subscriptionId: 'sub-unknown', state: { time: 1_000, value: 100 } }),
    );
    expect(events).toEqual([]);
  });

  it('emits one IndicatorChanged per state key (excluding `time`) on the first observation of a bound subscription, with prev=null and current wrapped in the matching StateValue variant', () => {
    const events: RulesV2.EvaluationTriggerEvent[] = [];
    const bridge = new IndicatorCascadeBridge((event) => events.push(event));
    bridge.bindSubscription('sub-1', 'instance-1');
    bridge.handleIndicatorState(
      stateEvent({
        subscriptionId: 'sub-1',
        id: 'AAPL',
        state: { time: 1_000, value: 100, signal: 'up', primed: true },
      }),
    );
    expect(events).toEqual([
      {
        kind: RulesV2.EvaluationTriggerKind.IndicatorChanged,
        ts: 1_000,
        symbolId: 'AAPL',
        instanceId: 'instance-1',
        stateKey: 'value',
        prev: null,
        current: { type: StateValueType.Number, value: 100 },
      },
      {
        kind: RulesV2.EvaluationTriggerKind.IndicatorChanged,
        ts: 1_000,
        symbolId: 'AAPL',
        instanceId: 'instance-1',
        stateKey: 'signal',
        prev: null,
        current: { type: StateValueType.Enum, value: 'up' },
      },
      {
        kind: RulesV2.EvaluationTriggerKind.IndicatorChanged,
        ts: 1_000,
        symbolId: 'AAPL',
        instanceId: 'instance-1',
        stateKey: 'primed',
        prev: null,
        current: { type: StateValueType.Bool, value: true },
      },
    ]);
  });

  it('on subsequent observations emits an IndicatorChanged only for state keys whose value differs from the prior observation on the same (symbolId, period, instanceId, stateKey) slot', () => {
    const events: RulesV2.EvaluationTriggerEvent[] = [];
    const bridge = new IndicatorCascadeBridge((event) => events.push(event));
    bridge.bindSubscription('sub-1', 'instance-1');
    bridge.handleIndicatorState(
      stateEvent({
        subscriptionId: 'sub-1',
        state: { time: 1_000, value: 100, signal: 'up' },
      }),
    );
    events.length = 0;
    bridge.handleIndicatorState(
      stateEvent({
        subscriptionId: 'sub-1',
        state: { time: 2_000, value: 101, signal: 'up' },
      }),
    );
    expect(events).toEqual([
      {
        kind: RulesV2.EvaluationTriggerKind.IndicatorChanged,
        ts: 2_000,
        symbolId: 'AAPL',
        instanceId: 'instance-1',
        stateKey: 'value',
        prev: { type: StateValueType.Number, value: 100 },
        current: { type: StateValueType.Number, value: 101 },
      },
    ]);
  });
});
