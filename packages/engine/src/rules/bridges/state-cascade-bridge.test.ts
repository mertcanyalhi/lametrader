import {
  type EvaluationTriggerEvent,
  EvaluationTriggerKind,
  type StateChangedEvent,
  StateScope,
  StateValueType,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { StateCascadeBridge } from './state-cascade-bridge.js';

describe('StateCascadeBridge', () => {
  it('emits SymbolStateChanged carrying profileId, symbolId, key, prev, current, ts when scope is Symbol', () => {
    const events: EvaluationTriggerEvent[] = [];
    const bridge = new StateCascadeBridge((event) => events.push(event));
    const inbound: StateChangedEvent = {
      profileId: 'profile-A',
      scope: { kind: StateScope.Symbol, symbolId: 'BTC' },
      key: 'breakout-armed',
      prev: { type: StateValueType.Bool, value: false },
      current: { type: StateValueType.Bool, value: true },
      ts: 60_000,
    };
    bridge.handleStateChange(inbound);
    expect(events).toEqual([
      {
        kind: EvaluationTriggerKind.SymbolStateChanged,
        ts: 60_000,
        symbolId: 'BTC',
        profileId: 'profile-A',
        key: 'breakout-armed',
        prev: { type: StateValueType.Bool, value: false },
        current: { type: StateValueType.Bool, value: true },
      },
    ]);
  });

  it('emits GlobalStateChanged carrying profileId, key, prev, current, ts when scope is Global', () => {
    const events: EvaluationTriggerEvent[] = [];
    const bridge = new StateCascadeBridge((event) => events.push(event));
    const inbound: StateChangedEvent = {
      profileId: 'profile-B',
      scope: { kind: StateScope.Global },
      key: 'last-signal',
      prev: null,
      current: { type: StateValueType.String, value: 'long' },
      ts: 120_000,
    };
    bridge.handleStateChange(inbound);
    expect(events).toEqual([
      {
        kind: EvaluationTriggerKind.GlobalStateChanged,
        ts: 120_000,
        profileId: 'profile-B',
        key: 'last-signal',
        prev: null,
        current: { type: StateValueType.String, value: 'long' },
      },
    ]);
  });
});
