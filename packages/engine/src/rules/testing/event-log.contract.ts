import {
  type CycleOverflowRuleEvent,
  type ErrorRuleEvent,
  EvaluationTriggerKind,
  type EventLog,
  type EventLogAppendTarget,
  type FiredRuleEvent,
  type NotificationSentRuleEvent,
  type RuleEventEntry,
  RuleEventType,
  type StateRemovedRuleEvent,
  StateScope,
  type StateSetRuleEvent,
  StateValueType,
} from '@lametrader/core';
import { expect, it } from 'vitest';

/**
 * Build a fresh {@link EventLog} under test, stamped with a fixed
 * `firedAt` clock so full-payload assertions stay deterministic.
 */
export interface EventLogFactory {
  /** The event-log under test, freshly empty. */
  log: EventLog;
  /** Pre-existing ruleIds the test may write to (Mongo adapter only). */
  seedRuleIds?: string[];
  /** Pre-existing symbolIds the test may write to (Mongo adapter only). */
  seedSymbolIds?: string[];
}

/**
 * Fixed wall-clock used to stamp `firedAt` in the contract — the adapter
 * factory must inject `() => FIXED_FIRED_AT` so the assertions match.
 */
export const FIXED_FIRED_AT = 9_999;

/**
 * The shared behavioural contract every {@link EventLog} must
 * satisfy.
 *
 * Run against the in-memory adapter in the unit tier and the Mongo adapter
 * in the e2e tier (ADR 0001).
 *
 * @param make - builds a fresh, empty event-log. The factory may pre-seed
 *   rule and symbol ids needed by the adapter under test (Mongo needs the
 *   parent documents to exist).
 */
export function runEventLogContract(make: () => EventLogFactory | Promise<EventLogFactory>): void {
  /** A minimal `Fired` umbrella entry. */
  function firedEntry(): FiredRuleEvent {
    return {
      type: RuleEventType.Fired,
      ts: 1_000,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
      context: {
        inboundEvent: {
          kind: EvaluationTriggerKind.Tick,
          symbolId: 'AAPL',
          ts: 1_000,
          price: 101,
        },
        lookupSnapshot: {
          current: 101,
          open: 100,
          high: 102,
          low: 99,
          close: 100.5,
          volume: 50,
        },
      },
    };
  }

  /** A minimal `NotificationSent` entry. */
  function notificationEntry(): NotificationSentRuleEvent {
    return {
      type: RuleEventType.NotificationSent,
      ts: 1_000,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
      destinationName: 'main',
      body: 'price up',
    };
  }

  /** A minimal `StateSet` entry. */
  function stateSetEntry(): StateSetRuleEvent {
    return {
      type: RuleEventType.StateSet,
      ts: 1_000,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
      scope: StateScope.Symbol,
      key: 'last-fired',
      value: { type: StateValueType.Number, value: 1 },
    };
  }

  /** A minimal `StateRemoved` entry. */
  function stateRemovedEntry(): StateRemovedRuleEvent {
    return {
      type: RuleEventType.StateRemoved,
      ts: 1_000,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
      scope: StateScope.Global,
      key: 'stale-global',
    };
  }

  /** A minimal `Error` entry. */
  function errorEntry(): ErrorRuleEvent {
    return {
      type: RuleEventType.Error,
      ts: 1_000,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
      reason: 'transport failure',
    };
  }

  /** A minimal `CycleOverflow` entry. */
  function cycleOverflowEntry(): CycleOverflowRuleEvent {
    return {
      type: RuleEventType.CycleOverflow,
      ts: 1_000,
      ruleId: 'rule-1',
      symbolId: 'AAPL',
      cycleLimit: 8,
    };
  }

  it('appendRuleEvent + ruleEvents round-trips a Fired entry with firedAt stamped', async () => {
    const { log } = await make();
    const entry = firedEntry();
    await log.appendRuleEvent('rule-1', entry);
    expect(await log.ruleEvents('rule-1')).toEqual([{ ...entry, firedAt: FIXED_FIRED_AT }]);
  });

  it('appendRuleEvent + ruleEvents round-trips a NotificationSent entry', async () => {
    const { log } = await make();
    const entry = notificationEntry();
    await log.appendRuleEvent('rule-1', entry);
    expect(await log.ruleEvents('rule-1')).toEqual([{ ...entry, firedAt: FIXED_FIRED_AT }]);
  });

  it('appendRuleEvent + ruleEvents round-trips a StateSet entry', async () => {
    const { log } = await make();
    const entry = stateSetEntry();
    await log.appendRuleEvent('rule-1', entry);
    expect(await log.ruleEvents('rule-1')).toEqual([{ ...entry, firedAt: FIXED_FIRED_AT }]);
  });

  it('appendRuleEvent + ruleEvents round-trips a StateRemoved entry', async () => {
    const { log } = await make();
    const entry = stateRemovedEntry();
    await log.appendRuleEvent('rule-1', entry);
    expect(await log.ruleEvents('rule-1')).toEqual([{ ...entry, firedAt: FIXED_FIRED_AT }]);
  });

  it('appendRuleEvent + ruleEvents round-trips an Error entry', async () => {
    const { log } = await make();
    const entry = errorEntry();
    await log.appendRuleEvent('rule-1', entry);
    expect(await log.ruleEvents('rule-1')).toEqual([{ ...entry, firedAt: FIXED_FIRED_AT }]);
  });

  it('appendRuleEvent + ruleEvents round-trips a CycleOverflow entry', async () => {
    const { log } = await make();
    const entry = cycleOverflowEntry();
    await log.appendRuleEvent('rule-1', entry);
    expect(await log.ruleEvents('rule-1')).toEqual([{ ...entry, firedAt: FIXED_FIRED_AT }]);
  });

  it('appendSymbolEvent + symbolEvents round-trips a Fired entry with firedAt stamped', async () => {
    const { log } = await make();
    const entry = firedEntry();
    await log.appendSymbolEvent('AAPL', entry);
    expect(await log.symbolEvents('AAPL')).toEqual([{ ...entry, firedAt: FIXED_FIRED_AT }]);
  });

  it('ruleEvents returns events in append order', async () => {
    const { log } = await make();
    const first = notificationEntry();
    const second = errorEntry();
    await log.appendRuleEvent('rule-1', first);
    await log.appendRuleEvent('rule-1', second);
    expect(await log.ruleEvents('rule-1')).toEqual([
      { ...first, firedAt: FIXED_FIRED_AT },
      { ...second, firedAt: FIXED_FIRED_AT },
    ]);
  });

  it('symbolEvents returns events in append order', async () => {
    const { log } = await make();
    const first = notificationEntry();
    const second = errorEntry();
    await log.appendSymbolEvent('AAPL', first);
    await log.appendSymbolEvent('AAPL', second);
    expect(await log.symbolEvents('AAPL')).toEqual([
      { ...first, firedAt: FIXED_FIRED_AT },
      { ...second, firedAt: FIXED_FIRED_AT },
    ]);
  });

  it('ruleEvents returns an empty array for an unknown ruleId', async () => {
    const { log } = await make();
    expect(await log.ruleEvents('unknown')).toEqual([]);
  });

  it('symbolEvents returns an empty array for an unknown symbolId', async () => {
    const { log } = await make();
    expect(await log.symbolEvents('UNKNOWN')).toEqual([]);
  });

  it('preserves a caller-supplied firedAt (does not re-stamp)', async () => {
    const { log } = await make();
    const entry: NotificationSentRuleEvent = {
      ...notificationEntry(),
      firedAt: 1234,
    };
    await log.appendRuleEvent('rule-1', entry);
    expect(await log.ruleEvents('rule-1')).toEqual([entry]);
  });

  it('onAppend invokes the listener once per side with the stamped entry and matching target', async () => {
    const { log } = await make();
    const observed: Array<{ entry: RuleEventEntry; target: EventLogAppendTarget }> = [];
    log.onAppend((entry, target) => observed.push({ entry, target }));
    const entry = notificationEntry();
    await log.appendRuleEvent('rule-1', entry);
    await log.appendSymbolEvent('AAPL', entry);
    expect(observed).toEqual([
      { entry: { ...entry, firedAt: FIXED_FIRED_AT }, target: { kind: 'rule', ruleId: 'rule-1' } },
      {
        entry: { ...entry, firedAt: FIXED_FIRED_AT },
        target: { kind: 'symbol', symbolId: 'AAPL' },
      },
    ]);
  });

  it('onAppend unsubscribe stops further notifications', async () => {
    const { log } = await make();
    const observed: RuleEventEntry[] = [];
    const unsubscribe = log.onAppend((entry) => observed.push(entry));
    await log.appendRuleEvent('rule-1', notificationEntry());
    unsubscribe();
    await log.appendRuleEvent('rule-1', errorEntry());
    expect(observed).toEqual([{ ...notificationEntry(), firedAt: FIXED_FIRED_AT }]);
  });

  it('countSymbolEvents returns 0 for an unknown symbolId', async () => {
    const { log } = await make();
    expect(await log.countSymbolEvents('UNKNOWN')).toEqual(0);
  });

  it('countSymbolEvents returns the number of mirrored entries appended for that symbol', async () => {
    const { log } = await make();
    await log.appendSymbolEvent('AAPL', notificationEntry());
    await log.appendSymbolEvent('AAPL', errorEntry());
    await log.appendSymbolEvent('MSFT', notificationEntry());
    expect(await log.countSymbolEvents('AAPL')).toEqual(2);
  });
}
