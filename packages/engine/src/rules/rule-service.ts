import {
  type Rule,
  RuleHistoryType,
  RuleNotFoundError,
  type RuleRepository,
  validateRule,
} from '@lametrader/core';
import { nanoid } from 'nanoid';

/**
 * Options for {@link RuleService}: injectable id generator and clock so tests
 * are deterministic.
 */
export interface RuleServiceOptions {
  /** Generate a new rule id; defaults to nanoid. */
  newId?: () => string;
  /** Current epoch ms; defaults to `Date.now`. */
  now?: () => number;
}

/** Body accepted by {@link RuleService.create} — the client-controllable subset of a rule. */
export type RuleCreateInput = Omit<Rule, 'id' | 'events' | 'history' | 'createdAt' | 'updatedAt'>;

/**
 * Application use-case for managing {@link Rule}s through a single API the
 * HTTP layer drives.
 *
 * Depends only on the {@link RuleRepository} port. Mutating operations
 * (replace, enable / disable, reorder, remove) land in later sub-issues on
 * the same service.
 */
export class RuleService {
  /** Id generator (injectable; defaults to nanoid). */
  private readonly newId: () => string;
  /** Current clock (injectable; defaults to `Date.now`). */
  private readonly now: () => number;

  /**
   * @param rules - the rule persistence port.
   * @param options - injectable id generator and clock.
   */
  constructor(
    private readonly rules: RuleRepository,
    options: RuleServiceOptions = {},
  ) {
    this.newId = options.newId ?? (() => nanoid());
    this.now = options.now ?? Date.now;
  }

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

  /**
   * Create a rule from `input`. Generates the id and timestamps; seeds the
   * embedded `events[]` as empty and `history[]` with a single `Created`
   * entry. Validates the assembled rule via {@link validateRule}.
   *
   * @throws `RuleError` / `RuleConditionError` / `RuleOperatorError` /
   *   `TriggerError` / `ExpirationError` / `ActionError` on invalid input.
   */
  async create(input: RuleCreateInput): Promise<Rule> {
    const ts = this.now();
    const rule: Rule = {
      ...input,
      id: this.newId(),
      events: [],
      history: [{ type: RuleHistoryType.Created, ts }],
      createdAt: ts,
      updatedAt: ts,
    };
    validateRule(rule, ts);
    await this.rules.save(rule);
    return rule;
  }
}
