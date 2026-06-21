import {
  type IndicatorStateEvent,
  Period,
  type RuleEvent,
  RuleEventKind,
  StateValueType,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { IndicatorRuleEventBridge } from './indicator-rule-event-bridge.js';

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

describe('IndicatorRuleEventBridge', () => {
  it('ignores events for unbound subscription ids', () => {
    const events: RuleEvent[] = [];
    const bridge = new IndicatorRuleEventBridge((event) => events.push(event));
    bridge.handleState(stateEvent({ state: { time: 1000, value: 100 } }));
    expect(events).toEqual([]);
  });

  it('emits one IndicatorValueChanged per state key on the first observation', () => {
    const events: RuleEvent[] = [];
    const bridge = new IndicatorRuleEventBridge((event) => events.push(event));
    bridge.bindSubscription('sub-1', 'instance-1');
    bridge.handleState(stateEvent({ state: { time: 1000, value: 100, signal: 'up' } }));
    expect(events).toEqual([
      {
        kind: RuleEventKind.IndicatorValueChanged,
        ts: 1000,
        symbolId: 'AAPL',
        instanceId: 'instance-1',
        stateKey: 'value',
        prev: null,
        current: { type: StateValueType.Number, value: 100 },
      },
      {
        kind: RuleEventKind.IndicatorValueChanged,
        ts: 1000,
        symbolId: 'AAPL',
        instanceId: 'instance-1',
        stateKey: 'signal',
        prev: null,
        current: { type: StateValueType.Enum, value: 'up' },
      },
    ]);
  });

  it('emits only the state keys that changed on a subsequent state row', () => {
    const events: RuleEvent[] = [];
    const bridge = new IndicatorRuleEventBridge((event) => events.push(event));
    bridge.bindSubscription('sub-1', 'instance-1');
    bridge.handleState(stateEvent({ state: { time: 1000, value: 100, signal: 'up' } }));
    events.length = 0;
    bridge.handleState(stateEvent({ state: { time: 2000, value: 101, signal: 'up' } }));
    expect(events).toEqual([
      {
        kind: RuleEventKind.IndicatorValueChanged,
        ts: 2000,
        symbolId: 'AAPL',
        instanceId: 'instance-1',
        stateKey: 'value',
        prev: { type: StateValueType.Number, value: 100 },
        current: { type: StateValueType.Number, value: 101 },
      },
    ]);
  });

  it('round-trips an enum state value through the cache', () => {
    const events: RuleEvent[] = [];
    const bridge = new IndicatorRuleEventBridge((event) => events.push(event));
    bridge.bindSubscription('sub-1', 'instance-1');
    bridge.handleState(stateEvent({ state: { time: 1000, signal: 'up' } }));
    events.length = 0;
    bridge.handleState(stateEvent({ state: { time: 2000, signal: 'down' } }));
    expect(events).toEqual([
      {
        kind: RuleEventKind.IndicatorValueChanged,
        ts: 2000,
        symbolId: 'AAPL',
        instanceId: 'instance-1',
        stateKey: 'signal',
        prev: { type: StateValueType.Enum, value: 'up' },
        current: { type: StateValueType.Enum, value: 'down' },
      },
    ]);
  });

  it('skips state keys whose value is null (warm-up)', () => {
    const events: RuleEvent[] = [];
    const bridge = new IndicatorRuleEventBridge((event) => events.push(event));
    bridge.bindSubscription('sub-1', 'instance-1');
    bridge.handleState(stateEvent({ state: { time: 1000, value: null, signal: 'up' } }));
    expect(events.map((event) => 'stateKey' in event && event.stateKey)).toEqual(['signal']);
  });

  it('unbindSubscription stops further events being emitted for that subscription', () => {
    const events: RuleEvent[] = [];
    const bridge = new IndicatorRuleEventBridge((event) => events.push(event));
    bridge.bindSubscription('sub-1', 'instance-1');
    bridge.handleState(stateEvent({ state: { time: 1000, value: 100 } }));
    bridge.unbindSubscription('sub-1');
    bridge.handleState(stateEvent({ state: { time: 2000, value: 101 } }));
    expect(events.length).toBe(1);
  });
});
