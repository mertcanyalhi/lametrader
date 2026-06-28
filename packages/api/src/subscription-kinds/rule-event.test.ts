import { type RuleEventEntry, RuleEventType, StateScope, StateValueType } from '@lametrader/core';
import { describe, expect, it, vi } from 'vitest';

import { StreamHub } from '../stream-hub.js';
import { ruleEventSubscriptionKind } from './rule-event.js';

const ENTRY: RuleEventEntry = {
  type: RuleEventType.StateSet,
  ts: 1_700_000_100_000,
  firedAt: 1_700_000_100_500,
  ruleId: 'r-1',
  symbolId: 'crypto:BTCUSDT',
  scope: StateScope.Symbol,
  key: 'streak',
  value: { type: StateValueType.Number, value: 3 },
};

describe('ruleEventSubscriptionKind', () => {
  it('validates a subscribe message and returns the symbol id as input', () => {
    const kind = ruleEventSubscriptionKind({ ruleEventStream: new StreamHub<RuleEventEntry>() });

    expect(
      kind.validateSubscribe({ action: 'subscribe-rule-event', id: 'crypto:BTCUSDT' }),
    ).toEqual({ input: { id: 'crypto:BTCUSDT' } });
  });

  it('rejects a subscribe message that is missing the id', () => {
    const kind = ruleEventSubscriptionKind({ ruleEventStream: new StreamHub<RuleEventEntry>() });

    expect(kind.validateSubscribe({ action: 'subscribe-rule-event' })).toEqual({
      error: 'subscribe-rule-event requires id: string',
    });
  });

  it('acquires synchronously with the symbol id as the hub key', async () => {
    const kind = ruleEventSubscriptionKind({ ruleEventStream: new StreamHub<RuleEventEntry>() });

    expect(await kind.acquire({ id: 'crypto:BTCUSDT' })).toEqual({ key: 'crypto:BTCUSDT' });
  });

  it('subscribes to the hub so a published entry arrives as a {symbolId, entry} frame', () => {
    const ruleEventStream = new StreamHub<RuleEventEntry>();
    const kind = ruleEventSubscriptionKind({ ruleEventStream });
    const send = vi.fn<(frame: string) => void>();
    const unsubscribe = kind.subscribeHub('crypto:BTCUSDT', send);

    ruleEventStream.publish('crypto:BTCUSDT', ENTRY);
    unsubscribe();
    ruleEventStream.publish('crypto:BTCUSDT', ENTRY);

    expect(send.mock.calls.map((c) => JSON.parse(String(c[0])))).toEqual([
      { symbolId: 'crypto:BTCUSDT', entry: ENTRY },
    ]);
  });
});
