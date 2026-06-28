import { Period, RulesV2, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { InMemoryRuleRepository } from './in-memory-rule-repository.js';

function rule(overrides: Partial<RulesV2.Rule>): RulesV2.Rule {
  return {
    id: 'r1',
    profileId: 'profile-1',
    name: 'Test rule',
    scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'AAPL' },
    condition: {
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
    },
    trigger: { kind: RulesV2.TriggerKind.EveryTime },
    expiration: null,
    actions: [
      {
        kind: RulesV2.ActionKind.Notification,
        channel: RulesV2.NotificationChannel.Telegram,
        destinationName: 'main',
        template: 'price up',
      },
    ],
    enabled: true,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('InMemoryRuleRepository', () => {
  it('save then get returns the saved rule', async () => {
    const repo = new InMemoryRuleRepository();
    const r = rule({ id: 'r1' });
    await repo.save(r);
    expect(await repo.get('r1')).toEqual(r);
  });

  it('get returns null for an unknown id', async () => {
    const repo = new InMemoryRuleRepository();
    expect(await repo.get('missing')).toEqual(null);
  });

  it('save replaces an existing rule with the same id', async () => {
    const repo = new InMemoryRuleRepository();
    await repo.save(rule({ id: 'r1', name: 'first' }));
    await repo.save(rule({ id: 'r1', name: 'second' }));
    const fetched = await repo.get('r1');
    expect(fetched?.name).toEqual('second');
  });

  it('listEnabledForSymbol returns Symbol-scoped rules matching symbolId', async () => {
    const repo = new InMemoryRuleRepository();
    const aapl = rule({
      id: 'r1',
      scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'AAPL' },
    });
    const msft = rule({
      id: 'r2',
      scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'MSFT' },
    });
    await repo.save(aapl);
    await repo.save(msft);
    expect(await repo.listEnabledForSymbol('AAPL')).toEqual([aapl]);
  });

  it('listEnabledForSymbol returns Symbols-scoped rules whose symbolIds includes the argument', async () => {
    const repo = new InMemoryRuleRepository();
    const r = rule({
      id: 'r1',
      scope: { kind: RulesV2.RuleScopeKind.Symbols, symbolIds: ['AAPL', 'GOOG'] },
    });
    await repo.save(r);
    expect(await repo.listEnabledForSymbol('GOOG')).toEqual([r]);
  });

  it('listEnabledForSymbol returns AllSymbols-scoped rules for any symbolId', async () => {
    const repo = new InMemoryRuleRepository();
    const r = rule({
      id: 'r1',
      scope: { kind: RulesV2.RuleScopeKind.AllSymbols },
    });
    await repo.save(r);
    expect(await repo.listEnabledForSymbol('SPY')).toEqual([r]);
  });

  it('listEnabledForSymbol excludes rules with enabled: false', async () => {
    const repo = new InMemoryRuleRepository();
    const disabled = rule({ id: 'r1', enabled: false });
    await repo.save(disabled);
    expect(await repo.listEnabledForSymbol('AAPL')).toEqual([]);
  });

  it('listEnabledForSymbol filters by profileId when given', async () => {
    const repo = new InMemoryRuleRepository();
    const p1 = rule({ id: 'r1', profileId: 'profile-1' });
    const p2 = rule({ id: 'r2', profileId: 'profile-2' });
    await repo.save(p1);
    await repo.save(p2);
    expect(await repo.listEnabledForSymbol('AAPL', 'profile-1')).toEqual([p1]);
  });

  it('listEnabledForSymbol with null symbolId returns only AllSymbols-scoped rules', async () => {
    const repo = new InMemoryRuleRepository();
    const sym = rule({
      id: 'r1',
      scope: { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'AAPL' },
    });
    const all = rule({
      id: 'r2',
      scope: { kind: RulesV2.RuleScopeKind.AllSymbols },
    });
    await repo.save(sym);
    await repo.save(all);
    expect(await repo.listEnabledForSymbol(null)).toEqual([all]);
  });

  it('listEnabledForSymbol returns rules in ascending order', async () => {
    const repo = new InMemoryRuleRepository();
    const a = rule({ id: 'a', order: 2 });
    const b = rule({ id: 'b', order: 0 });
    const c = rule({ id: 'c', order: 1 });
    await repo.save(a);
    await repo.save(b);
    await repo.save(c);
    expect(await repo.listEnabledForSymbol('AAPL')).toEqual([b, c, a]);
  });
});

// Note: Period is imported only to ensure tests stay correct even though no
// trigger here references it; trigger fields default to EveryTime.
void Period;
