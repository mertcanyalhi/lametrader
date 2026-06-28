import { type RulesV2 as Core, RulesV2 } from '@lametrader/core';

/**
 * A {@link RulesV2.RuleRepository} backed by an in-memory map.
 *
 * Real adapter (not a test double): backs the unit tier and offline/demo
 * wiring; also doubles as the fake the rest of the v2 engine consumes in
 * unit tests.
 *
 * `listEnabledForSymbol` returns enabled rules whose scope could fire on the
 * given symbol — Symbol-scoped with matching `scope.symbolId`,
 * Symbols-scoped containing the id, and all AllSymbols-scoped — optionally
 * filtered by `profileId`.
 * `symbolId === null` returns every enabled rule regardless of scope, so
 * symbol-less events (Timer / GlobalStateChanged) can fan out per scope at
 * the orchestrator.
 *
 * Profile-enabled (`profile.enabled` kill-switch) filtering is deferred
 * until profiles-v2 lands; the Mongo adapter defers the same way.
 */
export class InMemoryRuleRepository implements Core.RuleRepository {
  /** ruleId -> rule. */
  private readonly store = new Map<string, Core.Rule>();

  /**
   * @param seed - initial rules to pre-populate with (default: empty).
   */
  constructor(seed: Iterable<Core.Rule> = []) {
    for (const rule of seed) this.store.set(rule.id, rule);
  }

  async list(): Promise<Core.Rule[]> {
    return [...this.store.values()];
  }

  async get(id: string): Promise<Core.Rule | null> {
    return this.store.get(id) ?? null;
  }

  async save(rule: Core.Rule): Promise<void> {
    this.store.set(rule.id, rule);
  }

  async remove(id: string): Promise<void> {
    this.store.delete(id);
  }

  async listEnabledForSymbol(symbolId: string | null, profileId?: string): Promise<Core.Rule[]> {
    const result: Core.Rule[] = [];
    for (const rule of this.store.values()) {
      if (!rule.enabled) continue;
      if (profileId !== undefined && rule.profileId !== profileId) continue;
      if (symbolId === null) {
        result.push(rule);
        continue;
      }
      if (scopeMatchesSymbol(rule.scope, symbolId)) result.push(rule);
    }
    return result;
  }
}

/**
 * Whether `scope` allows the rule to fire on `symbolId`.
 *
 * - `Symbol` scope: match if `scope.symbolId === symbolId`.
 * - `Symbols` scope: match if `scope.symbolIds` contains `symbolId`.
 * - `AllSymbols` scope: always match.
 */
function scopeMatchesSymbol(scope: Core.RuleScope, symbolId: string): boolean {
  switch (scope.kind) {
    case RulesV2.RuleScopeKind.AllSymbols:
      return true;
    case RulesV2.RuleScopeKind.Symbol:
      return scope.symbolId === symbolId;
    case RulesV2.RuleScopeKind.Symbols:
      return scope.symbolIds.includes(symbolId);
  }
}
