import {
  RuleNotFoundError,
  RulesV2,
  TickRuleNotEligibleError,
  type WatchlistRepository,
} from '@lametrader/core';
import { nanoid } from 'nanoid';

/**
 * Options for {@link RuleServiceV2}: injectable id generator and clock so
 * tests are deterministic.
 */
export interface RuleServiceV2Options {
  /** Generate a new rule id; defaults to nanoid. */
  newId?: () => string;
  /** Current epoch ms; defaults to {@link Date.now}. */
  now?: () => number;
}

/**
 * Body accepted by {@link RuleServiceV2.create} — the client-controllable
 * subset of a v2 {@link RulesV2.Rule}.
 *
 * v2 has no embedded `events` / `history` array (those live behind the
 * separate {@link RulesV2.EventLog} port per ADR 0016), so this omits only
 * identity + lifecycle stamps.
 */
export type RuleV2CreateInput = Omit<RulesV2.Rule, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Filter accepted by {@link RuleServiceV2.list}. Each field is independent;
 * setting all three ANDs them.
 */
export interface RuleV2ListFilters {
  /** Keep only rules with this `profileId`. */
  profileId?: string;
  /** Keep only rules whose scope admits this `symbolId` (Symbol / Symbols / AllSymbols match). */
  symbolId?: string;
  /** Keep only rules whose `enabled` flag matches. */
  enabled?: boolean;
}

/**
 * Pagination options for the event-log read endpoints.
 *
 * The repository returns events in append order; this service reverses to
 * newest-first and applies `before` + `limit` in memory.
 */
export interface EventListOptions {
  /** Max entries to return. Defaults to 50; capped at 500 to bound memory. */
  limit?: number;
  /** Return only entries with `ts < before` (epoch-ms cursor for "next page"). */
  before?: number;
}

/** The set of v2 trigger kinds that are tick-cadence (per ADR 0016). */
const TICK_CADENCE_TRIGGERS: ReadonlySet<RulesV2.TriggerKind> = new Set([
  RulesV2.TriggerKind.EveryTime,
  RulesV2.TriggerKind.Once,
  RulesV2.TriggerKind.OncePerBar,
]);

/** Default page size for the event-log read endpoints. */
const DEFAULT_EVENT_PAGE_SIZE = 50;
/** Hard cap on event-log page size to bound memory. */
const MAX_EVENT_PAGE_SIZE = 500;

/**
 * Application use-case for managing v2 {@link RulesV2.Rule}s through a single
 * API the HTTP layer drives.
 *
 * Depends on the v2 {@link RulesV2.RuleRepository}, v2 {@link RulesV2.EventLog},
 * and the existing {@link WatchlistRepository} (consulted only for the
 * tick-cadence eligibility check at create / patch time).
 */
export class RuleServiceV2 {
  /** Id generator (injectable; defaults to nanoid). */
  private readonly newId: () => string;
  /** Current clock (injectable; defaults to {@link Date.now}). */
  private readonly now: () => number;

  /**
   * @param rules - the v2 rule persistence port.
   * @param eventLog - the v2 event log port.
   * @param watchlist - the watchlist consulted for tick-cadence eligibility.
   * @param options - injectable id generator and clock.
   */
  constructor(
    private readonly rules: RulesV2.RuleRepository,
    private readonly eventLog: RulesV2.EventLog,
    private readonly watchlist: WatchlistRepository,
    options: RuleServiceV2Options = {},
  ) {
    this.newId = options.newId ?? (() => nanoid());
    this.now = options.now ?? Date.now;
  }

  /**
   * List rules, optionally filtered by `profileId` / `symbolId` / `enabled`.
   *
   * Always sorted by `order` ascending so reorder mutations are visible on
   * the next read.
   */
  async list(filters: RuleV2ListFilters = {}): Promise<RulesV2.Rule[]> {
    const all = await this.rules.list();
    const filtered = all.filter((rule) => {
      if (filters.profileId !== undefined && rule.profileId !== filters.profileId) return false;
      if (filters.enabled !== undefined && rule.enabled !== filters.enabled) return false;
      if (filters.symbolId !== undefined && !scopeAdmitsSymbol(rule.scope, filters.symbolId)) {
        return false;
      }
      return true;
    });
    return filtered.sort((a, b) => a.order - b.order);
  }

  /**
   * Get one rule by id.
   *
   * @throws {@link RuleNotFoundError} when no rule has that id.
   */
  async get(id: string): Promise<RulesV2.Rule> {
    const rule = await this.rules.get(id);
    if (!rule) {
      throw new RuleNotFoundError(`rule not found: ${id}`);
    }
    return rule;
  }

  /**
   * Create a rule from `input`. Generates the id and timestamps; persists via
   * the repository.
   *
   * Validates tick-cadence eligibility against the watchlist (per ADR 0016 —
   * `EveryTime` / `Once` / `OncePerBar` triggers require every referenced
   * symbol to be on the watchlist). `AllSymbols` scope is exempt: fan-out is
   * dynamic at fire-time.
   *
   * Trusts schema validation at the boundary (per ADR 0016 #11) — domain-level
   * field validation lives in the JSON schema.
   *
   * @throws {@link TickRuleNotEligibleError} when the tick gate rejects.
   */
  async create(input: RuleV2CreateInput): Promise<RulesV2.Rule> {
    await this.assertTickEligible(input.trigger, input.scope);
    const ts = this.now();
    const rule: RulesV2.Rule = {
      ...input,
      id: this.newId(),
      createdAt: ts,
      updatedAt: ts,
    };
    await this.rules.save(rule);
    return rule;
  }

  /**
   * Merge `partial` into the rule with id `id`, re-run the tick-cadence
   * eligibility check on the merged result, bump `updatedAt`, and persist.
   *
   * Identity (`id`, `createdAt`) is preserved; the partial cannot change them.
   *
   * @throws {@link RuleNotFoundError} when the id is unknown.
   * @throws {@link TickRuleNotEligibleError} when the merged rule fails the tick gate.
   */
  async patch(id: string, partial: Partial<RuleV2CreateInput>): Promise<RulesV2.Rule> {
    const existing = await this.get(id);
    const merged: RulesV2.Rule = {
      ...existing,
      ...partial,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: this.now(),
    };
    await this.assertTickEligible(merged.trigger, merged.scope);
    await this.rules.save(merged);
    return merged;
  }

  /**
   * Delete a rule by id.
   *
   * @throws {@link RuleNotFoundError} when the id is unknown.
   */
  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.rules.remove(id);
  }

  /**
   * Read one rule's mirrored events log, newest-first, paginated.
   *
   * @throws {@link RuleNotFoundError} when the rule does not exist.
   */
  async listEvents(id: string, options: EventListOptions = {}): Promise<RulesV2.RuleEventEntry[]> {
    await this.get(id);
    const events = await this.eventLog.ruleEvents(id);
    return paginate(events, options);
  }

  /**
   * Read one symbol's mirrored events log, newest-first, paginated. The
   * symbol does not need to be on the watchlist — fired rules from past
   * sessions remain readable after the symbol is unwatched.
   */
  async listSymbolEvents(
    symbolId: string,
    options: EventListOptions = {},
  ): Promise<RulesV2.RuleEventEntry[]> {
    const events = await this.eventLog.symbolEvents(symbolId);
    return paginate(events, options);
  }

  /**
   * Throw {@link TickRuleNotEligibleError} if `trigger` is tick-cadence and
   * any symbol referenced by `scope` is not on the watchlist.
   * `AllSymbols`-scoped rules are exempt: fan-out is dynamic at fire-time.
   */
  private async assertTickEligible(
    trigger: RulesV2.Trigger,
    scope: RulesV2.RuleScope,
  ): Promise<void> {
    if (!TICK_CADENCE_TRIGGERS.has(trigger.kind)) return;
    const referenced = referencedSymbolIds(scope);
    if (referenced === null) return;
    const unwatched: string[] = [];
    for (const symbolId of referenced) {
      if ((await this.watchlist.get(symbolId)) === null) unwatched.push(symbolId);
    }
    if (unwatched.length === 0) return;
    throw new TickRuleNotEligibleError(
      `Tick-cadence triggers require watched symbols; not watched: ${unwatched.join(', ')}.`,
      unwatched,
    );
  }
}

/**
 * Symbol ids the scope explicitly references, or `null` when the scope is
 * `AllSymbols` (and there's nothing to check at create time).
 */
function referencedSymbolIds(scope: RulesV2.RuleScope): string[] | null {
  switch (scope.kind) {
    case RulesV2.RuleScopeKind.Symbol:
      return [scope.symbolId];
    case RulesV2.RuleScopeKind.Symbols:
      return scope.symbolIds;
    case RulesV2.RuleScopeKind.AllSymbols:
      return null;
  }
}

/** Whether `scope` admits the given `symbolId` for the `list?symbolId=` filter. */
function scopeAdmitsSymbol(scope: RulesV2.RuleScope, symbolId: string): boolean {
  switch (scope.kind) {
    case RulesV2.RuleScopeKind.Symbol:
      return scope.symbolId === symbolId;
    case RulesV2.RuleScopeKind.Symbols:
      return scope.symbolIds.includes(symbolId);
    case RulesV2.RuleScopeKind.AllSymbols:
      return true;
  }
}

/** Reverse to newest-first, apply `before` cursor, slice to `limit`. */
function paginate(
  events: readonly RulesV2.RuleEventEntry[],
  options: EventListOptions,
): RulesV2.RuleEventEntry[] {
  const limit = Math.min(options.limit ?? DEFAULT_EVENT_PAGE_SIZE, MAX_EVENT_PAGE_SIZE);
  const before = options.before;
  const filtered = before === undefined ? events : events.filter((event) => event.ts < before);
  return [...filtered].sort((a, b) => b.ts - a.ts).slice(0, limit);
}
