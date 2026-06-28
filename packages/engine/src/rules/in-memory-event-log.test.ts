import { type RuleEventEntry, RuleEventType, StateScope, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { InMemoryEventLog } from './in-memory-event-log.js';

const FIRED_AT = 1_700_000_000_000;

/** Builds a `StateSet` entry — the variant the chart's markers consume. */
function stateSetEntry(overrides: Partial<RuleEventEntry> = {}): RuleEventEntry {
  return {
    type: RuleEventType.StateSet,
    ts: 1_700_000_100_000,
    ruleId: 'r-1',
    symbolId: 'crypto:BTCUSDT',
    scope: StateScope.Symbol,
    key: 'streak',
    value: { type: StateValueType.Number, value: 3 },
    ...overrides,
  } as RuleEventEntry;
}

describe('InMemoryEventLog.onAppend', () => {
  it('invokes the listener with the stamped entry and a symbol target after appendSymbolEvent', async () => {
    const log = new InMemoryEventLog(() => FIRED_AT);
    const calls: Array<[RuleEventEntry, unknown]> = [];
    log.onAppend((entry, target) => calls.push([entry, target]));

    await log.appendSymbolEvent('crypto:BTCUSDT', stateSetEntry());

    expect(calls).toEqual([
      [
        { ...stateSetEntry(), firedAt: FIRED_AT },
        { kind: 'symbol', symbolId: 'crypto:BTCUSDT' },
      ],
    ]);
  });

  it('invokes the listener with the stamped entry and a rule target after appendRuleEvent', async () => {
    const log = new InMemoryEventLog(() => FIRED_AT);
    const calls: Array<[RuleEventEntry, unknown]> = [];
    log.onAppend((entry, target) => calls.push([entry, target]));

    await log.appendRuleEvent('r-1', stateSetEntry());

    expect(calls).toEqual([
      [
        { ...stateSetEntry(), firedAt: FIRED_AT },
        { kind: 'rule', ruleId: 'r-1' },
      ],
    ]);
  });

  it('stops calling the listener after its returned unsubscribe runs', async () => {
    const log = new InMemoryEventLog(() => FIRED_AT);
    const calls: Array<[RuleEventEntry, unknown]> = [];
    const unsubscribe = log.onAppend((entry, target) => calls.push([entry, target]));

    unsubscribe();
    await log.appendSymbolEvent('crypto:BTCUSDT', stateSetEntry());

    expect(calls).toEqual([]);
  });

  it('fans each append to every active listener independently', async () => {
    const log = new InMemoryEventLog(() => FIRED_AT);
    const a: Array<[RuleEventEntry, unknown]> = [];
    const b: Array<[RuleEventEntry, unknown]> = [];
    log.onAppend((entry, target) => a.push([entry, target]));
    log.onAppend((entry, target) => b.push([entry, target]));

    await log.appendSymbolEvent('crypto:BTCUSDT', stateSetEntry());

    expect({ a, b }).toEqual({
      a: [
        [
          { ...stateSetEntry(), firedAt: FIRED_AT },
          { kind: 'symbol', symbolId: 'crypto:BTCUSDT' },
        ],
      ],
      b: [
        [
          { ...stateSetEntry(), firedAt: FIRED_AT },
          { kind: 'symbol', symbolId: 'crypto:BTCUSDT' },
        ],
      ],
    });
  });
});
