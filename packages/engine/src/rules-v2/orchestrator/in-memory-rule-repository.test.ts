import { RulesV2, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { InMemoryRuleRepository } from './in-memory-rule-repository.js';

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

const ruleWith = (
  id: string,
  profileId: string,
  scope: RulesV2.RuleScope,
  enabled: boolean,
): RulesV2.Rule => ({
  id,
  profileId,
  name: id,
  scope,
  condition: priceGt100,
  trigger: { kind: RulesV2.TriggerKind.EveryTime },
  expiration: null,
  actions: [],
  enabled,
  order: 0,
  createdAt: 0,
  updatedAt: 0,
});

describe('InMemoryRuleRepository', () => {
  it('save then get round-trips the rule by id', async () => {
    const repo = new InMemoryRuleRepository();
    const rule = ruleWith(
      'r1',
      'p1',
      { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' },
      true,
    );
    await repo.save(rule);
    expect(await repo.get('r1')).toEqual(rule);
  });

  it('listEnabledForSymbol(symbolId, profileId) returns enabled same-profile rules whose scope matches the symbol — Symbol with matching id, Symbols containing the id, and AllSymbols — and excludes the rest', async () => {
    const matchSymbolBtcP1 = ruleWith(
      'match-symbol-btc-p1',
      'p1',
      { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' },
      true,
    );
    const matchSymbolsListP1 = ruleWith(
      'match-symbols-list-p1',
      'p1',
      { kind: RulesV2.RuleScopeKind.Symbols, symbolIds: ['BTC', 'ETH'] },
      true,
    );
    const matchAllSymbolsP1 = ruleWith(
      'match-all-symbols-p1',
      'p1',
      { kind: RulesV2.RuleScopeKind.AllSymbols },
      true,
    );
    const wrongSymbolP1 = ruleWith(
      'wrong-symbol-p1',
      'p1',
      { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'ETH' },
      true,
    );
    const wrongListP1 = ruleWith(
      'wrong-list-p1',
      'p1',
      { kind: RulesV2.RuleScopeKind.Symbols, symbolIds: ['ETH', 'SOL'] },
      true,
    );
    const disabledP1 = ruleWith(
      'disabled-p1',
      'p1',
      { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' },
      false,
    );
    const wrongProfile = ruleWith(
      'wrong-profile',
      'p2',
      { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' },
      true,
    );
    const repo = new InMemoryRuleRepository([
      matchSymbolBtcP1,
      matchSymbolsListP1,
      matchAllSymbolsP1,
      wrongSymbolP1,
      wrongListP1,
      disabledP1,
      wrongProfile,
    ]);
    const got = await repo.listEnabledForSymbol('BTC', 'p1');
    expect(got).toEqual([matchSymbolBtcP1, matchSymbolsListP1, matchAllSymbolsP1]);
  });

  it('listEnabledForSymbol(null, profileId) returns every enabled rule on the matching profile regardless of scope', async () => {
    const symbol = ruleWith(
      's',
      'p1',
      { kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' },
      true,
    );
    const symbols = ruleWith(
      'ss',
      'p1',
      { kind: RulesV2.RuleScopeKind.Symbols, symbolIds: ['ETH'] },
      true,
    );
    const allSymbols = ruleWith('as', 'p1', { kind: RulesV2.RuleScopeKind.AllSymbols }, true);
    const otherProfile = ruleWith('op', 'p2', { kind: RulesV2.RuleScopeKind.AllSymbols }, true);
    const repo = new InMemoryRuleRepository([symbol, symbols, allSymbols, otherProfile]);
    expect(await repo.listEnabledForSymbol(null, 'p1')).toEqual([symbol, symbols, allSymbols]);
  });

  it('remove deletes the rule by id', async () => {
    const rule = ruleWith('r1', 'p1', { kind: RulesV2.RuleScopeKind.AllSymbols }, true);
    const repo = new InMemoryRuleRepository([rule]);
    await repo.remove('r1');
    expect(await repo.get('r1')).toEqual(null);
  });
});
