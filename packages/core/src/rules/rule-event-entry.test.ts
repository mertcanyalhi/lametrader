import { describe, expect, it } from 'vitest';
import { StateValueType } from '../state.types.js';
import { StateScope } from '../state-repository.types.js';
import { EvaluationTriggerKind } from './event.types.js';
import {
  type RuleEventContext,
  type RuleEventEntry,
  RuleEventType,
} from './rule-event-entry.types.js';

describe('RuleEventType', () => {
  it('carries the six stable string-valued variants the engine emits', () => {
    expect({
      Fired: RuleEventType.Fired,
      NotificationSent: RuleEventType.NotificationSent,
      StateSet: RuleEventType.StateSet,
      StateRemoved: RuleEventType.StateRemoved,
      Error: RuleEventType.Error,
      CycleOverflow: RuleEventType.CycleOverflow,
    }).toEqual({
      Fired: 'fired',
      NotificationSent: 'notificationSent',
      StateSet: 'stateSet',
      StateRemoved: 'stateRemoved',
      Error: 'error',
      CycleOverflow: 'cycleOverflow',
    });
  });
});

describe('RuleEventEntry', () => {
  it('admits one branch per RuleEventType with its type-specific payload', () => {
    const context: RuleEventContext = {
      inboundEvent: {
        kind: EvaluationTriggerKind.Tick,
        ts: 1_000,
        symbolId: 'AAPL',
        price: 120,
      },
      lookupSnapshot: {
        current: 120,
        open: null,
        high: null,
        low: null,
        close: null,
        volume: null,
      },
    };
    const entries: RuleEventEntry[] = [
      {
        type: RuleEventType.Fired,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'AAPL',
        context,
      },
      {
        type: RuleEventType.NotificationSent,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'AAPL',
        destinationName: 'main',
        body: 'price up',
      },
      {
        type: RuleEventType.StateSet,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'AAPL',
        scope: StateScope.Symbol,
        key: 'trend',
        value: { type: StateValueType.String, value: 'up' },
      },
      {
        type: RuleEventType.StateRemoved,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'AAPL',
        scope: StateScope.Global,
        key: 'flag',
      },
      {
        type: RuleEventType.Error,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'AAPL',
        reason: 'Unknown notifier destination: nope',
      },
      {
        type: RuleEventType.CycleOverflow,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'AAPL',
        cycleLimit: 4,
      },
    ];
    expect(entries).toEqual([
      {
        type: RuleEventType.Fired,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'AAPL',
        context,
      },
      {
        type: RuleEventType.NotificationSent,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'AAPL',
        destinationName: 'main',
        body: 'price up',
      },
      {
        type: RuleEventType.StateSet,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'AAPL',
        scope: StateScope.Symbol,
        key: 'trend',
        value: { type: StateValueType.String, value: 'up' },
      },
      {
        type: RuleEventType.StateRemoved,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'AAPL',
        scope: StateScope.Global,
        key: 'flag',
      },
      {
        type: RuleEventType.Error,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'AAPL',
        reason: 'Unknown notifier destination: nope',
      },
      {
        type: RuleEventType.CycleOverflow,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'AAPL',
        cycleLimit: 4,
      },
    ]);
  });
});
