import {
  type FiringStateRepository,
  type Rule,
  type RuleEventEntry,
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
  /**
   * Firing-state store consulted by {@link RuleService.remove} to purge a
   * deleted rule's persisted firing-state entries. Optional — when absent
   * `remove` skips the cascade.
   */
  firingState?: FiringStateRepository;
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
  /** Firing-state store consulted by the delete cascade (optional). */
  private readonly firingState?: FiringStateRepository;

  /**
   * @param rules - the rule persistence port.
   * @param options - injectable id generator, clock, and cascade ports.
   */
  constructor(
    private readonly rules: RuleRepository,
    options: RuleServiceOptions = {},
  ) {
    this.newId = options.newId ?? (() => nanoid());
    this.now = options.now ?? Date.now;
    this.firingState = options.firingState;
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

  /**
   * Bulk-renumber rules' `order` to the contiguous 1-based positions of
   * `ids`. Every id in `ids` must resolve to an existing rule; ids missing
   * from the input keep their previous order. Bumps `updatedAt` on each
   * touched rule. Returns the updated rules in the new order.
   *
   * @throws {@link RuleNotFoundError} when any id is unknown.
   */
  async reorder(ids: readonly string[]): Promise<Rule[]> {
    const ts = this.now();
    const updated: Rule[] = [];
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i] as string;
      const existing = await this.get(id);
      const rule: Rule = { ...existing, order: i + 1, updatedAt: ts };
      await this.rules.save(rule);
      updated.push(rule);
    }
    return updated;
  }

  /**
   * Toggle a rule's `enabled` flag. Bumps `updatedAt` and appends an
   * `Enabled` or `Disabled` history entry. No-op when the current value
   * already matches `enabled` (still bumps `updatedAt` to surface the
   * write).
   *
   * @throws {@link RuleNotFoundError} when the id is unknown.
   */
  async setEnabled(id: string, enabled: boolean): Promise<Rule> {
    const existing = await this.get(id);
    const ts = this.now();
    const rule: Rule = {
      ...existing,
      enabled,
      history: [
        ...existing.history,
        { type: enabled ? RuleHistoryType.Enabled : RuleHistoryType.Disabled, ts },
      ],
      updatedAt: ts,
    };
    await this.rules.save(rule);
    return rule;
  }

  /**
   * Delete a rule by id. When the optional `firingState` port is wired in,
   * purges every persisted firing-state entry for the rule too — same pattern
   * as the profile cascade in #131.
   *
   * @throws {@link RuleNotFoundError} when the id is unknown.
   */
  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.rules.remove(id);
    if (this.firingState !== undefined) {
      await this.firingState.removeByRule(id);
    }
  }

  /**
   * List a rule's embedded events newest-first, paginated.
   *
   * Pagination:
   * - `limit` caps the page size; defaults to 50.
   * - `before` returns only entries with `ts < before` — cursor for "next page".
   *
   * @throws {@link RuleNotFoundError} when the id is unknown.
   */
  async listEvents(
    id: string,
    options: { limit?: number; before?: number } = {},
  ): Promise<RuleEventEntry[]> {
    const rule = await this.get(id);
    const limit = options.limit ?? 50;
    const before = options.before;
    const filtered =
      before === undefined ? rule.events : rule.events.filter((event) => event.ts < before);
    return [...filtered].sort((a, b) => b.ts - a.ts).slice(0, limit);
  }

  /**
   * Replace a rule's mutable fields by id. Preserves `id`, `events`,
   * `history` (with a new `Updated` entry appended), and `createdAt`; bumps
   * `updatedAt`. Validates the assembled rule via {@link validateRule}.
   *
   * @throws {@link RuleNotFoundError} when the id is unknown.
   * @throws `RuleError` / per-piece validators on invalid input.
   */
  async replace(id: string, input: RuleCreateInput): Promise<Rule> {
    const existing = await this.get(id);
    const ts = this.now();
    const rule: Rule = {
      ...input,
      id,
      events: existing.events,
      history: [...existing.history, { type: RuleHistoryType.Updated, ts }],
      createdAt: existing.createdAt,
      updatedAt: ts,
    };
    validateRule(rule, ts);
    await this.rules.save(rule);
    return rule;
  }
}
