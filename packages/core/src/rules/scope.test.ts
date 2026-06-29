import { describe, expect, it } from 'vitest';

import { type RuleScope, RuleScopeKind } from './scope.types.js';

describe('RuleScope', () => {
  it('admits Symbol, Symbols(list), and AllSymbols variants', () => {
    const scopes: RuleScope[] = [
      { kind: RuleScopeKind.Symbol, symbolId: 'BTC' },
      { kind: RuleScopeKind.Symbols, symbolIds: ['BTC', 'ETH'] },
      { kind: RuleScopeKind.AllSymbols },
    ];
    expect(scopes).toEqual([
      { kind: RuleScopeKind.Symbol, symbolId: 'BTC' },
      { kind: RuleScopeKind.Symbols, symbolIds: ['BTC', 'ETH'] },
      { kind: RuleScopeKind.AllSymbols },
    ]);
  });
});
