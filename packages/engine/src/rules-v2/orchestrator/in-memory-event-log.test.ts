import { RulesV2 } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { InMemoryEventLog } from './in-memory-event-log.js';

/** A minimal NotificationSent entry shaped for the InMemoryEventLog tests. */
function notificationEntry(): RulesV2.RuleEventEntry {
  return {
    type: RulesV2.RuleEventType.NotificationSent,
    ts: 1_000,
    ruleId: 'r1',
    symbolId: 'AAPL',
    destinationName: 'main',
    body: 'price up',
  };
}

describe('InMemoryEventLog', () => {
  it('appendRuleEvent then ruleEvents returns the stamped entry', async () => {
    const log = new InMemoryEventLog(() => 9_999);
    await log.appendRuleEvent('r1', notificationEntry());
    const events = await log.ruleEvents('r1');
    expect(events).toEqual([
      {
        type: RulesV2.RuleEventType.NotificationSent,
        ts: 1_000,
        firedAt: 9_999,
        ruleId: 'r1',
        symbolId: 'AAPL',
        destinationName: 'main',
        body: 'price up',
      },
    ]);
  });

  it('appendSymbolEvent then symbolEvents returns the stamped entry', async () => {
    const log = new InMemoryEventLog(() => 9_999);
    await log.appendSymbolEvent('AAPL', notificationEntry());
    const events = await log.symbolEvents('AAPL');
    expect(events).toEqual([
      {
        type: RulesV2.RuleEventType.NotificationSent,
        ts: 1_000,
        firedAt: 9_999,
        ruleId: 'r1',
        symbolId: 'AAPL',
        destinationName: 'main',
        body: 'price up',
      },
    ]);
  });

  it('onAppend invokes the listener once per side with the stamped entry and the matching target', async () => {
    const log = new InMemoryEventLog(() => 9_999);
    const observed: Array<{ entry: RulesV2.RuleEventEntry; target: RulesV2.EventLogAppendTarget }> =
      [];
    log.onAppend((entry, target) => observed.push({ entry, target }));
    await log.appendRuleEvent('r1', notificationEntry());
    await log.appendSymbolEvent('AAPL', notificationEntry());
    expect(observed).toEqual([
      {
        entry: {
          type: RulesV2.RuleEventType.NotificationSent,
          ts: 1_000,
          firedAt: 9_999,
          ruleId: 'r1',
          symbolId: 'AAPL',
          destinationName: 'main',
          body: 'price up',
        },
        target: { kind: 'rule', ruleId: 'r1' },
      },
      {
        entry: {
          type: RulesV2.RuleEventType.NotificationSent,
          ts: 1_000,
          firedAt: 9_999,
          ruleId: 'r1',
          symbolId: 'AAPL',
          destinationName: 'main',
          body: 'price up',
        },
        target: { kind: 'symbol', symbolId: 'AAPL' },
      },
    ]);
  });
});
