import { describe, expect, it } from 'vitest';
import { type RuleEventEntry, RuleEventType } from './rule.types.js';
import { StateValueType } from './state.types.js';
import { StateScope } from './state-repository.types.js';
import { listSymbolStateEvents } from './symbol-state-events.js';

describe('listSymbolStateEvents', () => {
  it('returns [] when symbol.events is undefined', () => {
    expect(listSymbolStateEvents({})).toEqual([]);
  });

  it('returns [] when symbol.events is empty', () => {
    expect(listSymbolStateEvents({ events: [] })).toEqual([]);
  });

  it('returns only StateSet and StateRemoved entries, in original order, with full payloads', () => {
    const stateSet = {
      type: RuleEventType.StateSet,
      ts: 100,
      ruleId: 'r1',
      symbolId: 'AAPL',
      scope: StateScope.Symbol,
      key: 'trend',
      value: { type: StateValueType.Enum, value: 'up' },
    } as const satisfies RuleEventEntry;
    const fired = {
      type: RuleEventType.Fired,
      ts: 101,
      ruleId: 'r1',
      symbolId: 'AAPL',
    } as const satisfies RuleEventEntry;
    const stateRemoved = {
      type: RuleEventType.StateRemoved,
      ts: 102,
      ruleId: 'r2',
      symbolId: 'AAPL',
      scope: StateScope.Symbol,
      key: 'armed',
    } as const satisfies RuleEventEntry;
    const expired = {
      type: RuleEventType.Expired,
      ts: 103,
      ruleId: 'r1',
      symbolId: 'AAPL',
    } as const satisfies RuleEventEntry;

    expect(listSymbolStateEvents({ events: [stateSet, fired, stateRemoved, expired] })).toEqual([
      stateSet,
      stateRemoved,
    ]);
  });
});
