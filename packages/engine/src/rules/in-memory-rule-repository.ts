import { type Rule, type RuleRepository, RuleScopeKind } from '@lametrader/core';

/**
 * A {@link RuleRepository} backed by an in-memory map.
 *
 * Real (not a test double): backs the unit tier and offline/demo wiring.
 */
export class InMemoryRuleRepository implements RuleRepository {
  /** ruleId → rule. */
  private readonly store = new Map<string, Rule>();

  /**
   * @param seed - initial rules to pre-populate with (default: empty).
   */
  constructor(seed: Iterable<Rule> = []) {
    for (const rule of seed) {
      this.store.set(rule.id, rule);
    }
  }

  async list(): Promise<Rule[]> {
    return [...this.store.values()];
  }

  async listForSymbol(symbolId: string | null): Promise<Rule[]> {
    const result: Rule[] = [];
    for (const rule of this.store.values()) {
      if (rule.scope.kind === RuleScopeKind.AllSymbols) {
        result.push(rule);
        continue;
      }
      if (symbolId !== null && rule.scope.symbolId === symbolId) {
        result.push(rule);
      }
    }
    return result;
  }

  async get(id: string): Promise<Rule | null> {
    return this.store.get(id) ?? null;
  }

  async save(rule: Rule): Promise<void> {
    this.store.set(rule.id, rule);
  }

  async remove(id: string): Promise<void> {
    this.store.delete(id);
  }
}
