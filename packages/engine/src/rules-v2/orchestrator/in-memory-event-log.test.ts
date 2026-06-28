import { RulesV2 } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { InMemoryEventLog } from './in-memory-event-log.js';

const tickAt = (ts: number): RulesV2.EvaluationTriggerEvent => ({
  kind: RulesV2.EvaluationTriggerKind.Tick,
  ts,
  symbolId: 'BTC',
  price: 100,
});

const firedEntry = (ts: number): RulesV2.RuleEventEntry => ({
  type: RulesV2.RuleEventType.Fired,
  ts,
  ruleId: 'r1',
  symbolId: 'BTC',
  context: {
    inboundEvent: tickAt(ts),
    lookupSnapshot: { current: 100, open: null, high: null, low: null, close: null, volume: null },
  },
});

describe('InMemoryEventLog', () => {
  it('appendRuleEvent stamps firedAt from the injected clock and ruleEvents returns the stamped entries in append order', async () => {
    const log = new InMemoryEventLog(() => 5_000);
    await log.appendRuleEvent('r1', firedEntry(1_000));
    await log.appendRuleEvent('r1', firedEntry(2_000));
    expect(await log.ruleEvents('r1')).toEqual([
      { ...firedEntry(1_000), firedAt: 5_000 },
      { ...firedEntry(2_000), firedAt: 5_000 },
    ]);
  });

  it('appendSymbolEvent stamps firedAt independently of appendRuleEvent and symbolEvents returns the stamped entries in append order', async () => {
    const log = new InMemoryEventLog(() => 7_000);
    await log.appendSymbolEvent('BTC', firedEntry(1_000));
    await log.appendSymbolEvent('BTC', firedEntry(2_000));
    expect(await log.symbolEvents('BTC')).toEqual([
      { ...firedEntry(1_000), firedAt: 7_000 },
      { ...firedEntry(2_000), firedAt: 7_000 },
    ]);
  });

  it('preserves a caller-supplied firedAt so mirrored writes share the same stamp', async () => {
    const log = new InMemoryEventLog(() => 5_000);
    const preStamped: RulesV2.RuleEventEntry = { ...firedEntry(1_000), firedAt: 9_000 };
    await log.appendRuleEvent('r1', preStamped);
    await log.appendSymbolEvent('BTC', preStamped);
    expect({
      ruleEvents: await log.ruleEvents('r1'),
      symbolEvents: await log.symbolEvents('BTC'),
    }).toEqual({
      ruleEvents: [preStamped],
      symbolEvents: [preStamped],
    });
  });

  it('onAppend fires once per side with the stamped entry and the matching target discriminator', async () => {
    const log = new InMemoryEventLog(() => 5_000);
    const received: Array<{ entry: RulesV2.RuleEventEntry; target: RulesV2.EventLogAppendTarget }> =
      [];
    log.onAppend((entry, target) => received.push({ entry, target }));
    const entry = firedEntry(1_000);
    await log.appendRuleEvent('r1', entry);
    await log.appendSymbolEvent('BTC', entry);
    expect(received).toEqual([
      { entry: { ...entry, firedAt: 5_000 }, target: { kind: 'rule', ruleId: 'r1' } },
      { entry: { ...entry, firedAt: 5_000 }, target: { kind: 'symbol', symbolId: 'BTC' } },
    ]);
  });
});
