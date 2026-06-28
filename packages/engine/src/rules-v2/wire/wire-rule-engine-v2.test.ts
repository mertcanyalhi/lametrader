import {
  type Notifier,
  Period,
  RulesV2,
  StateValueType,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { InMemoryStateRepository } from '../../state/in-memory-state-repository.js';
import { InMemoryWatchlistRepository } from '../../symbols/in-memory-watchlist-repository.js';
import { InMemoryEventLog } from '../orchestrator/in-memory-event-log.js';
import { InMemoryRuleRepository } from '../orchestrator/in-memory-rule-repository.js';
import { wireRuleEngineV2 } from './wire-rule-engine-v2.js';

class RecordingNotifier implements Notifier {
  readonly sends: Array<{ destinationName: string; body: string }> = [];
  async send(destinationName: string, body: string): Promise<void> {
    this.sends.push({ destinationName, body });
  }
}

const watched = (id: string): WatchedSymbol => ({
  id,
  type: SymbolType.Crypto,
  description: id,
  exchange: 'test',
  periods: [Period.OneMinute],
});

const priceGt100: RulesV2.ConditionNode = {
  kind: RulesV2.ConditionNodeKind.Leaf,
  leaf: {
    family: RulesV2.LeafConditionFamily.Comparison,
    operator: RulesV2.ComparisonOperator.Gt,
    left: { kind: RulesV2.OperandKind.Price },
    right: {
      kind: RulesV2.OperandKind.Literal,
      value: { type: StateValueType.Number, value: 100 },
    },
  },
};

const rule = (overrides: Partial<RulesV2.Rule> = {}): RulesV2.Rule => ({
  id: 'r1',
  profileId: 'p1',
  name: 'r1',
  scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' },
  condition: priceGt100,
  trigger: { kind: RulesV2.TriggerKind.EveryTime },
  expiration: null,
  actions: [
    {
      kind: RulesV2.ActionKind.Notification,
      channel: RulesV2.NotificationChannel.Telegram,
      destinationName: 'main',
      template: 'fired {symbolId}',
    },
  ],
  enabled: true,
  order: 1,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

describe('wireRuleEngineV2', () => {
  it('drives a TickEvent through the tickBridge, fires an enabled EveryTime Price>100 rule, and appends a NotificationSent + Fired entry to both the rule log and the symbol log', async () => {
    const repo = new InMemoryRuleRepository([rule()]);
    const eventLog = new InMemoryEventLog(() => 0);
    const notifier = new RecordingNotifier();
    const wired = wireRuleEngineV2({
      rules: repo,
      watchlist: new InMemoryWatchlistRepository([watched('BTC')]),
      state: new InMemoryStateRepository(),
      notifier,
      eventLog,
    });

    wired.tickBridge.handleQuote({
      id: 'BTC',
      subscriptionId: 'sub-1',
      period: Period.OneMinute,
      quote: { time: 1_000, price: 120 },
    });
    await wired.drain();

    expect({
      ruleEventTypes: (await eventLog.ruleEvents('r1')).map((entry) => entry.type),
      symbolEventTypes: (await eventLog.symbolEvents('BTC')).map((entry) => entry.type),
      sends: notifier.sends,
    }).toEqual({
      ruleEventTypes: [RulesV2.RuleEventType.NotificationSent, RulesV2.RuleEventType.Fired],
      symbolEventTypes: [RulesV2.RuleEventType.NotificationSent, RulesV2.RuleEventType.Fired],
      sends: [{ destinationName: 'main', body: 'fired BTC' }],
    });
  });
});
