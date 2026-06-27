import {
  type ProfileRepository,
  type Rule,
  type RuleRepository,
  RuleScopeKind,
} from '@lametrader/core';

/**
 * A {@link RuleRepository} backed by an in-memory map.
 *
 * Real (not a test double): backs the unit tier and offline/demo wiring.
 *
 * `listEnabledForSymbol` consults the optional injected
 * {@link ProfileRepository} to enforce the parent `profile.enabled`
 * runtime kill-switch (#290); when no profile repo is provided, every
 * profile reads as enabled (back-compat for tests that pre-date the
 * filter).
 */
export class InMemoryRuleRepository implements RuleRepository {
  /** ruleId → rule. */
  private readonly store = new Map<string, Rule>();
  /** Optional profile repo consulted for the `profile.enabled` filter. */
  private readonly profiles: ProfileRepository | undefined;

  /**
   * @param seed - initial rules to pre-populate with (default: empty).
   * @param profiles - optional profile repo for the `profile.enabled` filter.
   */
  constructor(seed: Iterable<Rule> = [], profiles?: ProfileRepository) {
    for (const rule of seed) {
      this.store.set(rule.id, rule);
    }
    this.profiles = profiles;
  }

  async list(): Promise<Rule[]> {
    return [...this.store.values()];
  }

  async listForSymbol(symbolId: string | null, profileId?: string): Promise<Rule[]> {
    const result: Rule[] = [];
    for (const rule of this.store.values()) {
      if (profileId !== undefined && rule.profileId !== profileId) continue;
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

  async listEnabledForSymbol(symbolId: string | null, profileId?: string): Promise<Rule[]> {
    const candidates = await this.listForSymbol(symbolId, profileId);
    const enabled = candidates.filter((rule) => rule.enabled);
    if (this.profiles === undefined) return enabled;
    const profileIds = [...new Set(enabled.map((rule) => rule.profileId))];
    const enabledProfileIds = new Set<string>();
    for (const id of profileIds) {
      const profile = await this.profiles.get(id);
      if (profile?.enabled === true) enabledProfileIds.add(id);
    }
    return enabled.filter((rule) => enabledProfileIds.has(rule.profileId));
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

  async removeForProfile(profileId: string): Promise<string[]> {
    const removed: string[] = [];
    for (const rule of this.store.values()) {
      if (rule.profileId === profileId) removed.push(rule.id);
    }
    for (const id of removed) this.store.delete(id);
    return removed;
  }
}
