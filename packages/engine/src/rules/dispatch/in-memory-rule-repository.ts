import type { ProfileRepository } from '@lametrader/core';
import {
  normalizeRule,
  type Rule,
  type RuleRepository,
  type RuleScope,
  RuleScopeKind,
} from '@lametrader/core';

/**
 * In-memory backing store for {@link RuleRepository}.
 *
 * Real adapter — backs the unit tier and offline/demo wiring.
 * Shares the contract suite with the Mongo adapter (#394, ADR 0001).
 *
 * Consults an optional injected {@link ProfileRepository} to enforce the
 * parent `profile.enabled` runtime kill-switch in {@link listEnabledForSymbol}.
 * When no profile repo is provided, every profile reads as enabled
 * (back-compat for tests that pre-date the filter, mirrors v1).
 */
export class InMemoryRuleRepository implements RuleRepository {
  /** Internal store, keyed by `Rule.id`. */
  private readonly byId = new Map<string, Rule>();
  /** Optional profile repo consulted for the `profile.enabled` filter. */
  private readonly profiles: ProfileRepository | undefined;

  /**
   * @param seed - initial rules to pre-populate with (default: empty).
   * @param profiles - optional profile repo for the `profile.enabled` filter.
   */
  constructor(seed: Iterable<Rule> = [], profiles?: ProfileRepository) {
    for (const rule of seed) this.byId.set(rule.id, rule);
    this.profiles = profiles;
  }

  async list(): Promise<Rule[]> {
    return [...this.byId.values()].map(normalizeRule);
  }

  async listForSymbol(symbolId: string | null, profileId?: string): Promise<Rule[]> {
    const out: Rule[] = [];
    for (const rule of this.byId.values()) {
      if (profileId !== undefined && rule.profileId !== profileId) continue;
      if (!scopeMatches(rule.scope, symbolId)) continue;
      out.push(normalizeRule(rule));
    }
    return out;
  }

  async listEnabledForSymbol(symbolId: string | null, profileId?: string): Promise<Rule[]> {
    const candidates = await this.listForSymbol(symbolId, profileId);
    const enabled = candidates.filter((rule) => rule.enabled);
    const profileFiltered = await this.filterByEnabledProfile(enabled);
    profileFiltered.sort((a, b) => a.order - b.order);
    return profileFiltered;
  }

  async get(id: string): Promise<Rule | null> {
    const rule = this.byId.get(id);
    return rule ? normalizeRule(rule) : null;
  }

  async claimOnceFire(ruleId: string): Promise<boolean> {
    // Read-and-write with no `await` between them, so the transition is
    // atomic w.r.t. the single-threaded event loop — concurrent per-symbol
    // chains cannot both observe `enabled: true` here.
    const rule = this.byId.get(ruleId);
    if (rule === undefined || !rule.enabled) return false;
    this.byId.set(ruleId, { ...rule, enabled: false });
    return true;
  }

  async save(rule: Rule): Promise<void> {
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
  private async filterByEnabledProfile(rules: Rule[]): Promise<Rule[]> {
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
function scopeMatches(scope: RuleScope, symbolId: string | null): boolean {
  if (scope.kind === RuleScopeKind.AllSymbols) return true;
  if (symbolId === null) return false;
  if (scope.kind === RuleScopeKind.Symbol) return scope.symbolId === symbolId;
  return scope.symbolIds.includes(symbolId);
}
