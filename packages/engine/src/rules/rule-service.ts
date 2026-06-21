import { type Rule, RuleNotFoundError, type RuleRepository } from '@lametrader/core';

/**
 * Application use-case for reading {@link Rule}s through a single read API the
 * HTTP layer drives.
 *
 * Depends only on the {@link RuleRepository} port. Mutating operations
 * (create, replace, enable / disable, reorder, remove) are added in later
 * sub-issues on the same service.
 */
export class RuleService {
  /**
   * @param rules - the rule persistence port.
   */
  constructor(private readonly rules: RuleRepository) {}

  /**
   * List rules, optionally filtered by `profileId` and / or `symbolId`.
   *
   * - With `symbolId` set, the underlying `listForSymbol` filter is used —
   *   Symbol-scoped rules whose `symbolId` matches plus every
   *   AllSymbols-scoped rule pass.
   * - With only `profileId` set, returns every rule belonging to that profile
   *   across all symbol scopes.
   * - With neither set, returns every stored rule.
   */
  async list(filters: { profileId?: string; symbolId?: string } = {}): Promise<Rule[]> {
    if (filters.symbolId !== undefined) {
      return await this.rules.listForSymbol(filters.symbolId, filters.profileId);
    }
    const all = await this.rules.list();
    return filters.profileId === undefined
      ? all
      : all.filter((rule) => rule.profileId === filters.profileId);
  }

  /**
   * Get one rule by id.
   *
   * @throws {@link RuleNotFoundError} when no rule has that id.
   */
  async get(id: string): Promise<Rule> {
    const rule = await this.rules.get(id);
    if (!rule) {
      throw new RuleNotFoundError(`rule not found: ${id}`);
    }
    return rule;
  }
}
