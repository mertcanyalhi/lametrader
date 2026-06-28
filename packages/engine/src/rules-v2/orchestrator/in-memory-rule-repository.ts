import { RulesV2 } from '@lametrader/core';

/**
 * A v2 {@link RulesV2.RuleRepository} backed by an in-memory map.
 *
 * Real (not a test double): backs the unit tier and offline/demo wiring;
 * doubles as the fake the rest of the engine consumes until #394 lands the
 * Mongo adapter.
 *
 * Profile-enabled filtering (#290) is deferred — there is no profile concept
 * in `@lametrader/core` v2 yet; when one lands, this repo will optionally
 * consult it the way v1's in-memory repo does.
 */
export class InMemoryRuleRepository implements RulesV2.RuleRepository {
  /** ruleId → rule. */
  private readonly store = new Map<string, RulesV2.Rule>();

  /**
   * @param seed - initial rules to pre-populate with (default: empty).
   */
  constructor(seed: Iterable<RulesV2.Rule> = []) {
    for (const rule of seed) {
      this.store.set(rule.id, rule);
    }
  }

  async list(): Promise<RulesV2.Rule[]> {
    return [...this.store.values()];
  }

  async get(id: string): Promise<RulesV2.Rule | null> {
    return this.store.get(id) ?? null;
  }

  async save(rule: RulesV2.Rule): Promise<void> {
    this.store.set(rule.id, rule);
  }

  async remove(id: string): Promise<void> {
    this.store.delete(id);
  }

  async listEnabledForSymbol(symbolId: string | null, profileId?: string): Promise<RulesV2.Rule[]> {
    const result: RulesV2.Rule[] = [];
    for (const rule of this.store.values()) {
      if (!rule.enabled) continue;
      if (profileId !== undefined && rule.profileId !== profileId) continue;
      if (symbolId === null) {
        result.push(rule);
        continue;
      }
      if (scopeMatches(rule.scope, symbolId)) result.push(rule);
    }
    return result;
  }
}

/**
 * Whether `scope` admits `symbolId` — Symbol matches its single id, Symbols
 * matches list membership, AllSymbols always matches.
 */
function scopeMatches(scope: RulesV2.RuleScope, symbolId: string): boolean {
  switch (scope.kind) {
    case RulesV2.RuleScopeKind.Symbol:
      return scope.symbolId === symbolId;
    case RulesV2.RuleScopeKind.Symbols:
      return scope.symbolIds.includes(symbolId);
    case RulesV2.RuleScopeKind.AllSymbols:
      return true;
  }
}
