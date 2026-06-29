import type { ProfileRepository } from '@lametrader/core';
import { RulesV2 } from '@lametrader/core';

/**
 * In-memory backing store for {@link RulesV2.RuleRepository}.
 *
 * Real adapter — backs the unit tier and offline/demo wiring.
 * Shares the contract suite with the Mongo adapter (#394, ADR 0001).
 *
 * Consults an optional injected {@link ProfileRepository} to enforce the
 * parent `profile.enabled` runtime kill-switch in {@link listEnabledForSymbol}.
 * When no profile repo is provided, every profile reads as enabled
 * (back-compat for tests that pre-date the filter, mirrors v1).
 */
export class InMemoryRuleRepository implements RulesV2.RuleRepository {
  /** Internal store, keyed by `Rule.id`. */
  private readonly byId = new Map<string, RulesV2.Rule>();
  /** Optional profile repo consulted for the `profile.enabled` filter. */
  private readonly profiles: ProfileRepository | undefined;

  /**
   * @param seed - initial rules to pre-populate with (default: empty).
   * @param profiles - optional profile repo for the `profile.enabled` filter.
   */
  constructor(seed: Iterable<RulesV2.Rule> = [], profiles?: ProfileRepository) {
    for (const rule of seed) this.byId.set(rule.id, rule);
    this.profiles = profiles;
  }

  async list(): Promise<RulesV2.Rule[]> {
    return [...this.byId.values()];
  }

  async listForSymbol(symbolId: string | null, profileId?: string): Promise<RulesV2.Rule[]> {
    const out: RulesV2.Rule[] = [];
    for (const rule of this.byId.values()) {
      if (profileId !== undefined && rule.profileId !== profileId) continue;
      if (!scopeMatches(rule.scope, symbolId)) continue;
      out.push(rule);
    }
    return out;
  }

  async listEnabledForSymbol(symbolId: string | null, profileId?: string): Promise<RulesV2.Rule[]> {
    const candidates = await this.listForSymbol(symbolId, profileId);
    const enabled = candidates.filter((rule) => rule.enabled);
    const profileFiltered = await this.filterByEnabledProfile(enabled);
    profileFiltered.sort((a, b) => a.order - b.order);
    return profileFiltered;
  }

  async get(id: string): Promise<RulesV2.Rule | null> {
    return this.byId.get(id) ?? null;
  }

  async save(rule: RulesV2.Rule): Promise<void> {
    this.byId.set(rule.id, rule);
  }

  async remove(id: string): Promise<void> {
    this.byId.delete(id);
  }

  async removeForProfile(profileId: string): Promise<string[]> {
    const removed: string[] = [];
    for (const rule of this.byId.values()) {
      if (rule.profileId === profileId) removed.push(rule.id);
    }
    for (const id of removed) this.byId.delete(id);
    return removed;
  }

  /**
   * Apply the `profile.enabled` filter when a {@link ProfileRepository} is
   * injected; otherwise read every profile as enabled.
   */
  private async filterByEnabledProfile(rules: RulesV2.Rule[]): Promise<RulesV2.Rule[]> {
    if (this.profiles === undefined) return rules;
    const profileIds = [...new Set(rules.map((rule) => rule.profileId))];
    const enabledProfileIds = new Set<string>();
    for (const id of profileIds) {
      const profile = await this.profiles.get(id);
      if (profile?.enabled === true) enabledProfileIds.add(id);
    }
    return rules.filter((rule) => enabledProfileIds.has(rule.profileId));
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
