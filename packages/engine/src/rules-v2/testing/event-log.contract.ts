import { RulesV2, StateScope, StateValueType } from '@lametrader/core';
import { expect, it } from 'vitest';

/**
 * Builds a fresh, empty {@link RulesV2.EventLog} under test with a clock that
 * always returns `firedAtClock`.
 *
 * The factory is the production constructor — the in-memory adapter for the
 * unit-tier run, the Mongo adapter for the e2e-tier run.
 */
export type EventLogV2Factory = (
  firedAtClock: number,
) => Promise<RulesV2.EventLog> | RulesV2.EventLog;

/**
 * The shared behavioural contract every v2 {@link RulesV2.EventLog} must
 * satisfy.
 *
 * Run against the in-memory adapter in the unit tier and the Mongo adapter
 * in the e2e tier, so ports and adapters stay LSP-equivalent (per ADR 0001).
 *
 * @param make - builds a fresh, empty event log with a fixed `firedAt` clock.
 */
export function runEventLogContract(make: EventLogV2Factory): void {
  it('appendRuleEvent stamps firedAt from the injected clock and ruleEvents returns the stamped entries in append order', async () => {
    const log = await make(5_000);
    await log.appendRuleEvent('r1', firedEntry(1_000));
    await log.appendRuleEvent('r1', firedEntry(2_000));
    expect(await log.ruleEvents('r1')).toEqual([
      { ...firedEntry(1_000), firedAt: 5_000 },
      { ...firedEntry(2_000), firedAt: 5_000 },
    ]);
  });

  it('appendSymbolEvent stamps firedAt from the injected clock and symbolEvents returns the stamped entries in append order', async () => {
    const log = await make(7_000);
    await log.appendSymbolEvent('BTC', firedEntry(1_000));
    await log.appendSymbolEvent('BTC', firedEntry(2_000));
    expect(await log.symbolEvents('BTC')).toEqual([
      { ...firedEntry(1_000), firedAt: 7_000 },
      { ...firedEntry(2_000), firedAt: 7_000 },
    ]);
  });

  it('preserves a caller-supplied firedAt so mirrored writes share the same stamp', async () => {
    const log = await make(5_000);
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
    const log = await make(5_000);
    const received: Array<{
      entry: RulesV2.RuleEventEntry;
      target: RulesV2.EventLogAppendTarget;
    }> = [];
    log.onAppend((entry, target) => received.push({ entry, target }));
    const entry = firedEntry(1_000);
    await log.appendRuleEvent('r1', entry);
    await log.appendSymbolEvent('BTC', entry);
    expect(received).toEqual([
      { entry: { ...entry, firedAt: 5_000 }, target: { kind: 'rule', ruleId: 'r1' } },
      { entry: { ...entry, firedAt: 5_000 }, target: { kind: 'symbol', symbolId: 'BTC' } },
    ]);
  });

  it('ruleEvents returns [] for an id with no events stored', async () => {
    const log = await make(5_000);
    expect(await log.ruleEvents('absent')).toEqual([]);
  });

  it('symbolEvents returns [] for an id with no events stored', async () => {
    const log = await make(5_000);
    expect(await log.symbolEvents('absent')).toEqual([]);
  });

  it('round-trips every RuleEventEntry variant through appendRuleEvent + ruleEvents', async () => {
    const log = await make(5_000);
    const entries: RulesV2.RuleEventEntry[] = [
      {
        type: RulesV2.RuleEventType.Fired,
        ts: 1_000,
        ruleId: 'r1',
        symbolId: 'BTC',
        context: {
          inboundEvent: {
            kind: RulesV2.EvaluationTriggerKind.Tick,
            ts: 1_000,
            symbolId: 'BTC',
            price: 100,
          },
          lookupSnapshot: {
            current: 100,
            open: 99,
            high: 101,
            low: 98,
            close: 100,
            volume: 1_234,
          },
        },
      },
      {
        type: RulesV2.RuleEventType.CycleOverflow,
        ts: 1_100,
        ruleId: 'r1',
        symbolId: 'BTC',
        cycleLimit: 16,
      },
      {
        type: RulesV2.RuleEventType.StateSet,
        ts: 1_200,
        ruleId: 'r1',
        symbolId: 'BTC',
        scope: StateScope.Symbol,
        key: 'phase',
        value: { type: StateValueType.String, value: 'on' },
      },
      {
        type: RulesV2.RuleEventType.StateSet,
        ts: 1_300,
        ruleId: 'r1',
        symbolId: 'BTC',
        scope: StateScope.Global,
        key: 'regime',
        value: { type: StateValueType.Bool, value: true },
      },
      {
        type: RulesV2.RuleEventType.StateRemoved,
        ts: 1_400,
        ruleId: 'r1',
        symbolId: 'BTC',
        scope: StateScope.Symbol,
        key: 'phase',
      },
      {
        type: RulesV2.RuleEventType.NotificationSent,
        ts: 1_500,
        ruleId: 'r1',
        symbolId: 'BTC',
        destinationName: 'main',
        body: 'hello',
      },
      {
        type: RulesV2.RuleEventType.Error,
        ts: 1_600,
        ruleId: 'r1',
        symbolId: 'BTC',
        reason: 'unknown destination "x"',
      },
      {
        type: RulesV2.RuleEventType.Expired,
        ts: 1_700,
        ruleId: 'r1',
        symbolId: 'BTC',
      },
    ];
    for (const entry of entries) await log.appendRuleEvent('r1', entry);
    expect(await log.ruleEvents('r1')).toEqual(
      entries.map((entry) => ({ ...entry, firedAt: 5_000 })),
    );
  });
}

/** Build a minimal-valid `Fired` entry whose only varying field is `ts`. */
function firedEntry(ts: number): RulesV2.RuleEventEntry {
  return {
    type: RulesV2.RuleEventType.Fired,
    ts,
    ruleId: 'r1',
    symbolId: 'BTC',
    context: {
      inboundEvent: {
        kind: RulesV2.EvaluationTriggerKind.Tick,
        ts,
        symbolId: 'BTC',
        price: 100,
      },
      lookupSnapshot: {
        current: 100,
        open: null,
        high: null,
        low: null,
        close: null,
        volume: null,
      },
    },
  };
}
