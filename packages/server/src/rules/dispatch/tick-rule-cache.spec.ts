import {
  ActionKind,
  ComparisonOperator,
  ConditionNodeKind,
  LeafConditionFamily,
  NotificationChannel,
  OperandKind,
  type Rule,
  RuleScopeKind,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';

import { type RuleListSource, TickRuleCache } from './tick-rule-cache.js';

/**
 * A minimal enabled Rule the cache can hand back — its contents don't matter,
 * only that the same array instance flows through on a cache hit.
 */
const SENTINEL_RULE: Rule = {
  id: 'r1',
  profileId: 'profile-1',
  name: 'sentinel',
  scope: { kind: RuleScopeKind.Symbol, symbolId: 'AAPL' },
  condition: {
    kind: ConditionNodeKind.Leaf,
    leaf: {
      family: LeafConditionFamily.Comparison,
      operator: ComparisonOperator.Gt,
      left: { kind: OperandKind.Price },
      right: { kind: OperandKind.Literal, value: { type: StateValueType.Number, value: 100 } },
    },
  },
  trigger: { kind: TriggerKind.EveryTime },
  expiration: null,
  actions: [
    {
      kind: ActionKind.Notification,
      channel: NotificationChannel.Telegram,
      destinationName: 'main',
      template: 'fired',
    },
  ],
  enabled: true,
  order: 0,
  createdAt: 0,
  updatedAt: 0,
};

/** Records every `listEnabledForSymbol` call so the cache's dedupe is observable. */
class CountingSource implements RuleListSource {
  readonly calls: Array<{ symbolId: string | null; profileId: string | undefined }> = [];

  async listEnabledForSymbol(symbolId: string | null, profileId?: string): Promise<Rule[]> {
    this.calls.push({ symbolId, profileId });
    return [SENTINEL_RULE];
  }
}

describe('TickRuleCache', () => {
  it('queries the source once for a repeated (symbolId, profileId) key and returns the same rules', async () => {
    const source = new CountingSource();
    const cache = new TickRuleCache(source);
    const first = await cache.listEnabledForSymbol('AAPL', 'profile-1');
    const second = await cache.listEnabledForSymbol('AAPL', 'profile-1');
    expect(source.calls).toEqual([{ symbolId: 'AAPL', profileId: 'profile-1' }]);
    expect(second).toEqual(first);
  });

  it('queries the source again for a different (symbolId, profileId) key', async () => {
    const source = new CountingSource();
    const cache = new TickRuleCache(source);
    await cache.listEnabledForSymbol('AAPL', 'profile-1');
    await cache.listEnabledForSymbol('AAPL', 'profile-2');
    expect(source.calls).toEqual([
      { symbolId: 'AAPL', profileId: 'profile-1' },
      { symbolId: 'AAPL', profileId: 'profile-2' },
    ]);
  });

  it('distinguishes a null symbolId with a profile from a symbol with no profile', async () => {
    const source = new CountingSource();
    const cache = new TickRuleCache(source);
    await cache.listEnabledForSymbol(null, 'profile-1');
    await cache.listEnabledForSymbol('profile-1', undefined);
    expect(source.calls).toEqual([
      { symbolId: null, profileId: 'profile-1' },
      { symbolId: 'profile-1', profileId: undefined },
    ]);
  });
});
