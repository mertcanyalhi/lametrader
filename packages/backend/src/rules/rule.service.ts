import {
  type ConditionNode,
  type EventLog,
  type Period,
  type Rule,
  type RuleEventEntry,
  RuleEventType,
  type RuleRepository,
  type RuleScope,
  RuleScopeKind,
  type Trigger,
  TriggerKind,
  type WatchlistRepository,
} from '@lametrader/core';
import { nanoid } from 'nanoid';
import {
  InvalidRuleConditionError,
  RuleNotFoundError,
  TickRuleNotEligibleError,
} from '../domain/rule.js';
import {
  collectConditionIntervals,
  validateRuleCondition,
} from '../domain/rules/condition-validate.js';

/**
 * Options for {@link RuleService}: injectable id generator and clock so
 * tests are deterministic.
 */
export interface RuleServiceOptions {
  /** Generate a new rule id; defaults to nanoid. */
  newId?: () => string;
  /** Current epoch ms; defaults to {@link Date.now}. */
  now?: () => number;
}

/**
 * Body accepted by {@link RuleService.create} — the client-controllable
 * subset of a {@link Rule}.
 *
 * Rules have no embedded `events` / `history` array (those live behind the
 * separate {@link EventLog} port per ADR 0016), so this omits only identity
 * + lifecycle stamps.
 */
export type RuleCreateInput = Omit<Rule, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Filter accepted by {@link RuleService.list}. Each field is independent;
 * setting all three ANDs them.
 */
export interface RuleListFilters {
  /** Keep only rules with this `profileId`. */
  profileId?: string;
  /** Keep only rules whose scope admits this `symbolId` (Symbol / Symbols / AllSymbols match). */
  symbolId?: string;
  /** Keep only rules whose `enabled` flag matches. */
  enabled?: boolean;
}

/**
 * Pagination + windowing options for the event-log read endpoints.
 *
 * The repository returns events in append order; this service reverses to
 * newest-first and applies `from` / `to` / `before` + `limit` in memory.
 *
 * `from` and `to` define an inclusive-exclusive window on the entry's source
 * `ts` (the candle / tick timestamp that drove evaluation) — the chart's
 * visible window maps directly onto them.
 * `before` is the older "next page" cursor and ANDs with the window when both
 * are supplied.
 */
export interface EventListOptions {
  /** Max entries to return. Defaults to 50; capped at 500 to bound memory. */
  limit?: number;
  /** Return only entries with `ts < before` (epoch-ms cursor for "next page"). */
  before?: number;
  /** Inclusive lower bound on the entry's source `ts` (epoch ms). */
  from?: number;
  /** Exclusive upper bound on the entry's source `ts` (epoch ms). */
  to?: number;
  /**
   * Chart-state filter for the chart's marker read.
   *
   * When defined, keep only `stateSet` / `stateRemoved` entries whose `key`
   * is in this list; every other event type and every non-matching key is
   * dropped.
   * An empty list keeps nothing; `undefined` disables the filter (unfiltered),
   * so the Events list dialog + count badge — which pass no `chartStates` —
   * still see the full log.
   */
  chartStates?: readonly string[];
}

/** The set of trigger kinds that are tick-cadence (per ADR 0016). */
const TICK_CADENCE_TRIGGERS: ReadonlySet<TriggerKind> = new Set([
  TriggerKind.EveryTime,
  TriggerKind.Once,
  TriggerKind.OncePerBar,
]);

/** Default page size for the event-log read endpoints. */
const DEFAULT_EVENT_PAGE_SIZE = 50;
/** Hard cap on event-log page size to bound memory. */
const MAX_EVENT_PAGE_SIZE = 500;

/**
 * Application use-case for managing {@link Rule}s through a single API the
 * HTTP layer drives.
 *
 * Depends on the {@link RuleRepository}, {@link EventLog}, and the existing
 * {@link WatchlistRepository} (consulted only for the tick-cadence
 * eligibility check at create / patch time).
 */
export class RuleService {
  /** Id generator (injectable; defaults to nanoid). */
  private readonly newId: () => string;
  /** Current clock (injectable; defaults to {@link Date.now}). */
  private readonly now: () => number;

  /**
   * @param rules - the rule persistence port.
   * @param eventLog - the event log port.
   * @param watchlist - the watchlist consulted for tick-cadence eligibility.
   * @param options - injectable id generator and clock.
   */
  constructor(
    private readonly rules: RuleRepository,
    private readonly eventLog: EventLog,
    private readonly watchlist: WatchlistRepository,
    options: RuleServiceOptions = {},
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
  async list(filters: RuleListFilters = {}): Promise<Rule[]> {
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
  async get(id: string): Promise<Rule> {
    const rule = await this.rules.get(id);
    if (rule === null) {
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
  async create(input: RuleCreateInput): Promise<Rule> {
    validateRuleCondition(input.condition);
    await this.assertIntervalsWatched(input.condition, input.scope);
    await this.assertTickEligible(input.trigger, input.scope);
    const ts = this.now();
    const rule: Rule = {
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
  async patch(id: string, partial: Partial<RuleCreateInput>): Promise<Rule> {
    const existing = await this.get(id);
    const merged: Rule = {
      ...existing,
      ...partial,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: this.now(),
    };
    validateRuleCondition(merged.condition);
    await this.assertIntervalsWatched(merged.condition, merged.scope);
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
  async listEvents(id: string, options: EventListOptions = {}): Promise<RuleEventEntry[]> {
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
  ): Promise<RuleEventEntry[]> {
    const events = await this.eventLog.symbolEvents(symbolId);
    return paginate(events, options);
  }

  /**
   * Count entries in one symbol's mirrored events log. Backs the chart-page
   * Events button badge (per issue #425); returns `0` for symbols with no
   * recorded events, including ones not on the watchlist.
   */
  async countSymbolEvents(symbolId: string): Promise<number> {
    return this.eventLog.countSymbolEvents(symbolId);
  }

  /**
   * Throw {@link TickRuleNotEligibleError} if `trigger` is tick-cadence and
   * any symbol referenced by `scope` is not on the watchlist.
   * `AllSymbols`-scoped rules are exempt: fan-out is dynamic at fire-time.
   */
  private async assertTickEligible(trigger: Trigger, scope: RuleScope): Promise<void> {
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

  /**
   * Throw {@link InvalidRuleConditionError} if the condition references a bar
   * `interval` that isn't watched for the rule's scoped symbols.
   *
   * `AllSymbols`-scoped rules are exempt (the symbol set is dynamic at
   * fire-time, mirroring {@link assertTickEligible}). The check runs against the
   * union of periods across the scoped symbols that are actually on the
   * watchlist; when none are watched there's nothing to validate against, so it
   * passes (unwatched-symbol handling is the tick-eligibility gate's concern).
   */
  private async assertIntervalsWatched(condition: ConditionNode, scope: RuleScope): Promise<void> {
    const intervals = collectConditionIntervals(condition);
    if (intervals.length === 0) return;
    const referenced = referencedSymbolIds(scope);
    if (referenced === null) return;
    const watchedPeriods = new Set<Period>();
    for (const symbolId of referenced) {
      const symbol = await this.watchlist.get(symbolId);
      if (symbol === null) continue;
      for (const period of symbol.periods) watchedPeriods.add(period);
    }
    if (watchedPeriods.size === 0) return;
    const unwatched = intervals.filter((interval) => !watchedPeriods.has(interval));
    if (unwatched.length === 0) return;
    throw new InvalidRuleConditionError(
      `Condition interval(s) not watched for the rule's symbols: ${unwatched.join(', ')}.`,
    );
  }
}

/**
 * Symbol ids the scope explicitly references, or `null` when the scope is
 * `AllSymbols` (and there's nothing to check at create time).
 */
function referencedSymbolIds(scope: RuleScope): string[] | null {
  switch (scope.kind) {
    case RuleScopeKind.Symbol:
      return [scope.symbolId];
    case RuleScopeKind.Symbols:
      return scope.symbolIds;
    case RuleScopeKind.AllSymbols:
      return null;
  }
}

/** Whether `scope` admits the given `symbolId` for the `list?symbolId=` filter. */
function scopeAdmitsSymbol(scope: RuleScope, symbolId: string): boolean {
  switch (scope.kind) {
    case RuleScopeKind.Symbol:
      return scope.symbolId === symbolId;
    case RuleScopeKind.Symbols:
      return scope.symbolIds.includes(symbolId);
    case RuleScopeKind.AllSymbols:
      return true;
  }
}

/**
 * Reverse to newest-first, apply the `from` / `to` window + `before` cursor,
 * slice to `limit`.
 *
 * Within one fire (every per-action entry plus the trailing `Fired` umbrella
 * share the same source `ts`), reversing the append-ordered slice puts the
 * last-appended entry first — so a fire reads as `Fired` then per-action
 * entries, matching the user-facing "newest first" semantics.
 *
 * `from` is inclusive (`ts >= from`); `to` and `before` are exclusive
 * (`ts < to`, `ts < before`).
 * All bounds AND together when supplied.
 */
function paginate(events: readonly RuleEventEntry[], options: EventListOptions): RuleEventEntry[] {
  const limit = Math.min(options.limit ?? DEFAULT_EVENT_PAGE_SIZE, MAX_EVENT_PAGE_SIZE);
  const { before, from, to, chartStates } = options;
  const filtered = events.filter((event) => {
    if (before !== undefined && !(event.ts < before)) return false;
    if (from !== undefined && !(event.ts >= from)) return false;
    if (to !== undefined && !(event.ts < to)) return false;
    if (chartStates !== undefined && !matchesChartStates(event, chartStates)) return false;
    return true;
  });
  return [...filtered]
    .reverse()
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit);
}

/**
 * Whether `event` is a state-change (`stateSet` / `stateRemoved`) whose `key`
 * is one of the chart-state keys the caller asked for.
 *
 * Non-state event types (`fired`, `notificationSent`, `error`,
 * `cycleOverflow`) never match, so they are dropped from a `chartStates`-
 * filtered read.
 */
function matchesChartStates(event: RuleEventEntry, chartStates: readonly string[]): boolean {
  if (event.type !== RuleEventType.StateSet && event.type !== RuleEventType.StateRemoved) {
    return false;
  }
  return chartStates.includes(event.key);
}
