import { RulesV2 } from '@lametrader/core';

/**
 * In-memory backing store for {@link RulesV2.RuleRepository}.
 *
 * Real adapter — backs the unit tier and offline/demo wiring.
 * The Mongo adapter lands in #394 with the same port.
 *
 * Lazy: skipped parent-profile enabled-flag enforcement (only the rule's own
 * `enabled` is checked). Upgrade path: when profiles land on this slice,
 * thread a `ProfileRepository` lookup through {@link listEnabledForSymbol}.
 */
export class InMemoryRuleRepository implements RulesV2.RuleRepository {
  /** Internal store, keyed by `Rule.id`. */
  private readonly byId = new Map<string, RulesV2.Rule>();

  async listEnabledForSymbol(symbolId: string | null, profileId?: string): Promise<RulesV2.Rule[]> {
    const out: RulesV2.Rule[] = [];
    for (const rule of this.byId.values()) {
      if (!rule.enabled) continue;
      if (profileId !== undefined && rule.profileId !== profileId) continue;
      if (!scopeMatches(rule.scope, symbolId)) continue;
      out.push(rule);
    }
    out.sort((a, b) => a.order - b.order);
    return out;
  }

  async get(id: string): Promise<RulesV2.Rule | null> {
    return this.byId.get(id) ?? null;
  }

  async save(rule: RulesV2.Rule): Promise<void> {
    this.byId.set(rule.id, rule);
  }
}

/**
 * Whether `scope` admits `symbolId`.
 *
 * `null` symbol means "symbol-less event" — only `AllSymbols` rules match.
 * `AllSymbols` always matches. `Symbol` matches on exact `symbolId`.
 * `Symbols` matches on list membership.
 */
function scopeMatches(scope: RulesV2.RuleScope, symbolId: string | null): boolean {
  if (scope.kind === RulesV2.RuleScopeKind.AllSymbols) return true;
  if (symbolId === null) return false;
  if (scope.kind === RulesV2.RuleScopeKind.Symbol) return scope.symbolId === symbolId;
  return scope.symbolIds.includes(symbolId);
}
