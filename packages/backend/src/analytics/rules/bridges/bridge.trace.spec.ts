import {
  EvaluationTriggerKind,
  Period,
  type StateChangedEvent,
  StateScope,
  StateValueType,
} from '@lametrader/core';
import type { CandleEvent } from '../../../market/interfaces/polling.service.types.js';
import { _resetLogRoot, _resetLogScopes } from '../engine-log.js';
import { BarLifecycleBridge } from './bar-lifecycle-bridge.js';
import { IndicatorCascadeBridge } from './indicator-cascade-bridge.js';
import { StateCascadeBridge } from './state-cascade-bridge.js';

function parseRecord(line: string): Record<string, unknown> {
  return JSON.parse(line);
}

/**
 * Reduce captured records to the bridges' own scope so a future engine.rules.*
 * trace from a different surface doesn't pollute the assertion.
 */
function bridgeRecords(records: Record<string, unknown>[]): Record<string, unknown>[] {
  return records.filter((r) => r.scope === 'engine.rules.bridges');
}

describe('bridges trace', () => {
  afterEach(() => {
    _resetLogRoot();
    _resetLogScopes([]);
  });

  it('StateCascadeBridge emits a bridge_emit trace with the outbound SymbolStateChanged payload', () => {
    const records: Record<string, unknown>[] = [];
    _resetLogRoot({
      write: (line) => {
        records.push(parseRecord(line));
      },
    });
    _resetLogScopes([{ pattern: 'engine.rules.bridges', level: 'trace' }]);
    const sink: EvaluationTriggerEvent[] = [];
    const bridge = new StateCascadeBridge((e) => sink.push(e));
    const inbound: StateChangedEvent = {
      profileId: 'profile-A',
      scope: { kind: StateScope.Symbol, symbolId: 'BTC' },
      key: 'armed',
      prev: { type: StateValueType.Bool, value: false },
      current: { type: StateValueType.Bool, value: true },
      ts: 60_000,
    };

    bridge.handleStateChange(inbound);

    expect(bridgeRecords(records)).toEqual([
      {
        level: 10,
        time: expect.any(Number),
        app: 'engine',
        scope: 'engine.rules.bridges',
        bridge: 'state-cascade',
        inboundEventKind: 'state-changed',
        emittedEventKind: EvaluationTriggerKind.SymbolStateChanged,
        payload: {
          kind: EvaluationTriggerKind.SymbolStateChanged,
          ts: 60_000,
          symbolId: 'BTC',
          profileId: 'profile-A',
          key: 'armed',
          prev: { type: StateValueType.Bool, value: false },
          current: { type: StateValueType.Bool, value: true },
        },
        msg: 'bridge_emit',
      },
    ]);
  });

  it('BarLifecycleBridge emits a bridge_emit trace per outbound BarOpened / BarClosed event', () => {
    const records: Record<string, unknown>[] = [];
    _resetLogRoot({
      write: (line) => {
        records.push(parseRecord(line));
      },
    });
    _resetLogScopes([{ pattern: 'engine.rules.bridges', level: 'trace' }]);
    const sink: EvaluationTriggerEvent[] = [];
    const bridge = new BarLifecycleBridge((e) => sink.push(e));
    const inbound: CandleEvent = {
      id: 'AAPL',
      period: Period.OneMinute,
      candle: { time: 60_000, open: 99, high: 102, low: 99, close: 101, volume: 10 },
      final: true,
    };

    bridge.handleCandle(inbound);

    expect(bridgeRecords(records)).toEqual([
      {
        level: 10,
        time: expect.any(Number),
        app: 'engine',
        scope: 'engine.rules.bridges',
        bridge: 'bar-lifecycle',
        inboundEventKind: 'candle',
        emittedEventKind: EvaluationTriggerKind.BarOpened,
        payload: {
          kind: EvaluationTriggerKind.BarOpened,
          ts: 60_000,
          symbolId: 'AAPL',
          period: Period.OneMinute,
        },
        msg: 'bridge_emit',
      },
      {
        level: 10,
        time: expect.any(Number),
        app: 'engine',
        scope: 'engine.rules.bridges',
        bridge: 'bar-lifecycle',
        inboundEventKind: 'candle',
        emittedEventKind: EvaluationTriggerKind.BarClosed,
        payload: {
          kind: EvaluationTriggerKind.BarClosed,
          ts: 60_000,
          symbolId: 'AAPL',
          period: Period.OneMinute,
        },
        msg: 'bridge_emit',
      },
    ]);
  });

  it('IndicatorCascadeBridge emits a bridge_emit trace per state key whose value changed (and stays silent on unchanged keys)', () => {
    const records: Record<string, unknown>[] = [];
    _resetLogRoot({
      write: (line) => {
        records.push(parseRecord(line));
      },
    });
    _resetLogScopes([{ pattern: 'engine.rules.bridges', level: 'trace' }]);
    const sink: EvaluationTriggerEvent[] = [];
    const bridge = new IndicatorCascadeBridge((e) => sink.push(e));
    bridge.bindSubscription('sub-1', 'inst-1', 'profile-A');

    // First emit: value=10 is brand-new (prev: null) — emits one trace.
    bridge.handleIndicatorState({
      subscriptionId: 'sub-1',
      id: 'AAPL',
      period: Period.OneMinute,
      indicatorKey: 'sma',
      state: { time: 1_000, value: 10 },
      final: false,
    });
    // Second emit: same value, no trace.
    bridge.handleIndicatorState({
      subscriptionId: 'sub-1',
      id: 'AAPL',
      period: Period.OneMinute,
      indicatorKey: 'sma',
      state: { time: 2_000, value: 10 },
      final: false,
    });

    expect(bridgeRecords(records)).toEqual([
      {
        level: 10,
        time: expect.any(Number),
        app: 'engine',
        scope: 'engine.rules.bridges',
        bridge: 'indicator-cascade',
        inboundEventKind: 'indicator-state',
        emittedEventKind: EvaluationTriggerKind.IndicatorChanged,
        payload: {
          kind: EvaluationTriggerKind.IndicatorChanged,
          ts: 1_000,
          symbolId: 'AAPL',
          profileId: 'profile-A',
          instanceId: 'inst-1',
          stateKey: 'value',
          prev: null,
          current: { type: StateValueType.Number, value: 10 },
        },
        msg: 'bridge_emit',
      },
    ]);
  });
});
