import {
  type BarOpenedEvent,
  type EvaluationTriggerEvent,
  EvaluationTriggerKind,
  type GlobalStateChangedEvent,
  type IndicatorChangedEvent,
  type Rule,
  type RuleEvent,
  type RuleEventContext,
  type RuleRepository,
  RuleScopeKind,
  type SymbolStateChangedEvent,
  TriggerKind,
} from '@lametrader/core';

import type { EvaluationContext } from '../evaluation-context.types.js';
import { evaluateCondition } from './evaluate-condition.js';
import { referencesSlot } from './references-slot.js';
import { routes } from './routes.js';

/**
 * Inputs for {@link TriggerDispatcher}.
 *
 * The dispatcher is pure routing + gating. Everything I/O (state lookups,
 * series resolution) goes through `buildContext`; everything write-side
 * (rule persistence) goes through `rules`. The orchestrator (#393) supplies
 * the real implementations.
 */
export interface TriggerDispatcherDeps {
  /** Read enabled rules + write back the auto-disabled `Once` rule. */
  rules: RuleRepository;
  /**
   * Build a fresh {@link EvaluationContext} for one
   * `(event, firingSymbolId, profileId)` triple — the dispatcher needs one
   * context per fan-out target.
   *
   * `profileId` is the firing rule's `profileId`, threaded so the context
   * can scope `SymbolStateRef` / `GlobalStateRef` lookups to the rule's
   * profile namespace.
   * Cascade events (`SymbolStateChanged` / `GlobalStateChanged`) carry their
   * own `profileId`; the dispatcher still passes the firing rule's value here
   * — both are guaranteed to match because the candidate query filters rules
   * by `event.profileId`.
   */
  buildContext: (event: RuleEvent, firingSymbolId: string, profileId: string) => EvaluationContext;
}

/**
 * Optional inputs per-dispatch.
 *
 * `watchedSymbolIds` is consulted ONLY when a symbol-less event (`Timer` or
 * `GlobalStateChanged`) needs to fan out over every watched symbol for
 * `AllSymbols`-scoped rules. The orchestrator (#393) supplies the list.
 */
export interface DispatchOptions {
  /** Watched symbol ids — used for fan-out on symbol-less events. */
  watchedSymbolIds?: readonly string[];
}

/**
 * One record of a rule firing — what the dispatcher returns to the caller
 * (the orchestrator in #393) which then runs the rule's actions.
 *
 * Lazy: no payload beyond the (rule, firingSymbol, event) tuple — the
 * orchestrator owns the {@link RuleEventContext} payload (it has the
 * lookups snapshot the dispatcher doesn't see). Upgrade path: thread a
 * `RuleEventContext` builder through the dispatcher when the snapshot needs
 * to be captured atomically with the gate decision.
 */
export interface FireRecord {
  /** The rule that fired. */
  ruleId: string;
  /** Which symbol the rule fired on (its firing symbol for this dispatch). */
  firingSymbolId: string;
  /** The event that drove the fire. */
  event: RuleEvent;
}

/**
 * The trigger dispatcher — turns one inbound {@link RuleEvent} into
 * a list of {@link FireRecord}s after routing + gating.
 *
 * Per dispatch:
 *
 * 1. Route the event to candidate rules. For a tick / bar / timer event,
 *    candidates come from `rules.listEnabledForSymbol(event.symbolId)`
 *    filtered by {@link routes}. For a cascade event, candidates come from
 *    the same query filtered by `referencesSlot` against the rule's
 *    condition tree. AllSymbols rules on a symbol-less event fan out via
 *    `options.watchedSymbolIds`.
 * 2. For each `(rule, firingSymbolId)` pair: build the context, evaluate
 *    the condition tree, and run the per-trigger gate.
 *    - `EveryTime` — no gate.
 *    - `Once` — gate fires on the first match, then we save the rule
 *      with `enabled: false` so the next dispatch's `listEnabledForSymbol`
 *      drops it.
 *    - `OncePerBar` — in-memory latch per `(ruleId, firingSymbolId,
 *      barStart)` records the last-fire bar; gate suppresses repeats
 *      until a `BarOpened(period)` clears the latch.
 *    - `OncePerBarOpen` / `OncePerBarClose` — admitted only by `routes`,
 *      no extra gate (one fire per matching bar event by definition).
 *    - `OncePerInterval` — in-memory last-fire ts per
 *      `(ruleId, firingSymbolId)`; gate suppresses repeats until
 *      `event.ts - lastFireTs >= intervalMs`.
 * 3. Update internal gate state and return one {@link FireRecord} per fire.
 *
 * The caller (orchestrator) then runs each fire's actions.
 */
export class TriggerDispatcher {
  /**
   * Per-`(ruleId, firingSymbolId, period)` boolean latch for `OncePerBar`
   * rules — `true` once the rule has fired within the current bar window.
   * The `BarOpened(period)` re-arm path clears matching entries; the gate
   * suppresses repeats while the entry is `true`.
   *
   * Per ADR 0016 / CONTEXT.md: "latch resets on the next BarOpened for that
   * period" — i.e. only an explicit BarOpened of the matching period
   * re-arms. A tick that crosses a bar boundary without an explicit
   * BarOpened doesn't itself re-arm (the bridges emit BarOpened exactly at
   * the boundary so in production both happen simultaneously).
   */
  private readonly oncePerBarLatch = new Set<string>();
  /**
   * Per-`(ruleId, firingSymbolId)` last-fire timestamp for
   * `OncePerInterval` rules. The gate compares against `event.ts -
   * lastFireTs >= intervalMs`.
   */
  private readonly lastIntervalFireTs = new Map<string, number>();

  constructor(private readonly deps: TriggerDispatcherDeps) {}

  /**
   * Dispatch one inbound event and return the list of fires (in
   * `(rule.order ASC, firingSymbolId)` order).
   *
   * The caller is responsible for executing the rules' actions and for
   * cascading any state mutations.
   */
  async dispatch(event: RuleEvent, options: DispatchOptions = {}): Promise<FireRecord[]> {
    // Data-update events don't drive evaluation by themselves (per ADR 0016
    // / CONTEXT.md); the orchestrator's lookups cache absorbs them.
    if (!isEvaluationTriggerEvent(event)) return [];

    // BarOpened — re-arm any `OncePerBar` latches whose period matches before
    // routing. (BarOpened doesn't itself fire OncePerBar rules, but it clears
    // their latches so the next matching tick can fire.)
    if (event.kind === EvaluationTriggerKind.BarOpened) {
      this.rearmOncePerBarLatches(event);
    }

    const candidates = await this.candidates(event, options);
    const fires: FireRecord[] = [];

    for (const { rule, firingSymbolId } of candidates) {
      const ctx = this.deps.buildContext(event, firingSymbolId, rule.profileId);
      if (!evaluateCondition(rule.condition, ctx)) continue;
      if (!this.gateAllows(rule, event, firingSymbolId)) continue;
      this.recordFire(rule, event, firingSymbolId);
      fires.push({ ruleId: rule.id, firingSymbolId, event });
      // `Once` auto-disable persists via the existing save path.
      if (rule.trigger.kind === TriggerKind.Once) {
        const fresh = await this.deps.rules.get(rule.id);
        if (fresh !== null) await this.deps.rules.save({ ...fresh, enabled: false });
      }
    }

    return fires;
  }

  /**
   * Expand the event into `(rule, firingSymbolId)` candidates after routing
   * (kind + period match) and cascade-slot filtering.
   *
   * For symbol-bearing events (`Tick`, `BarOpened`/`Closed`,
   * `SymbolStateChanged`, `IndicatorChanged`) we restrict to rules whose
   * scope admits `event.symbolId`.
   * For symbol-less events (`Timer`, `GlobalStateChanged`) we sweep every
   * enabled rule across all scopes and let `firingSymbolsFor` fan out using
   * the rule's scope (`Symbol`/`Symbols` → the rule's own ids;
   * `AllSymbols` → `options.watchedSymbolIds`).
   */
  private async candidates(
    event: EvaluationTriggerEvent,
    options: DispatchOptions,
  ): Promise<Array<{ rule: Rule; firingSymbolId: string }>> {
    const profileId =
      event.kind === EvaluationTriggerKind.SymbolStateChanged ||
      event.kind === EvaluationTriggerKind.GlobalStateChanged
        ? event.profileId
        : undefined;
    const symbolId = symbolIdOf(event);
    // Symbol-less events scan all scopes; symbol-bearing events scope-filter
    // via the repo. Either way the per-rule scope expansion below decides
    // the firing symbol(s).
    const enabled =
      symbolId === null
        ? await this.allEnabledAcrossScopes(profileId, options.watchedSymbolIds)
        : await this.deps.rules.listEnabledForSymbol(symbolId, profileId);

    const out: Array<{ rule: Rule; firingSymbolId: string }> = [];
    for (const rule of enabled) {
      // For cascade events, the rule must actually reference the changed
      // slot — otherwise we leave it asleep (AC: no spurious wake-ups).
      if (isCascadeEvent(event)) {
        if (!referencesSlot(rule.condition, event)) continue;
      } else {
        if (!routes(event, rule.trigger)) continue;
      }

      // Fan out to the rule's firing symbols.
      for (const firingSymbolId of firingSymbolsFor(rule, event, options)) {
        out.push({ rule, firingSymbolId });
      }
    }
    return out;
  }

  /**
   * Per-trigger gate decision.
   *
   * `EveryTime` always allows; `Once` always allows (the auto-disable in
   * `dispatch` makes the next `listEnabledForSymbol` drop the rule);
   * `OncePerBarOpen` / `OncePerBarClose` always allow (`routes` already
   * ensured kind + period match); `OncePerBar` checks the latch; and
   * `OncePerInterval` checks the elapsed time since last fire.
   */
  private gateAllows(rule: Rule, event: EvaluationTriggerEvent, firingSymbolId: string): boolean {
    switch (rule.trigger.kind) {
      case TriggerKind.EveryTime:
      case TriggerKind.Once:
      case TriggerKind.OncePerBarOpen:
      case TriggerKind.OncePerBarClose:
        return true;
      case TriggerKind.OncePerBar: {
        // Latch is cleared on BarOpened for the matching period; if the
        // entry isn't set, this is the first fire of the current bar window.
        const key = latchKey(rule.id, firingSymbolId, rule.trigger.period);
        return !this.oncePerBarLatch.has(key);
      }
      case TriggerKind.OncePerInterval: {
        const key = latchKey(rule.id, firingSymbolId);
        const last = this.lastIntervalFireTs.get(key);
        if (last === undefined) return true;
        return event.ts - last >= rule.trigger.intervalMs;
      }
    }
  }

  /**
   * Update internal gate state after a fire — sets the OncePerBar latch and
   * stamps the OncePerInterval last-fire timestamp.
   */
  private recordFire(rule: Rule, event: EvaluationTriggerEvent, firingSymbolId: string): void {
    if (rule.trigger.kind === TriggerKind.OncePerBar) {
      const key = latchKey(rule.id, firingSymbolId, rule.trigger.period);
      this.oncePerBarLatch.add(key);
    } else if (rule.trigger.kind === TriggerKind.OncePerInterval) {
      const key = latchKey(rule.id, firingSymbolId);
      this.lastIntervalFireTs.set(key, event.ts);
    }
  }

  /**
   * Drop any OncePerBar latches whose period matches the BarOpened event's
   * period — the next matching tick on that period will re-fire.
   *
   * Period is baked into the latch key (`<ruleId>|<sym>|<period>`); a
   * non-matching-period BarOpened leaves those latches alone.
   */
  private rearmOncePerBarLatches(event: BarOpenedEvent): void {
    for (const key of this.oncePerBarLatch) {
      if (keyHasPeriod(key, event.period)) this.oncePerBarLatch.delete(key);
    }
  }

  /**
   * Collect every enabled rule across `Symbol` / `Symbols` / `AllSymbols`
   * scopes — used by symbol-less events to find every rule whose scope
   * could be expanded to one or more symbols.
   *
   * Lazy: drains the repository via `listEnabledForSymbol(null)` (AllSymbols)
   * plus one call per watched symbol (`Symbol` / `Symbols`). Per-symbol calls
   * deduplicate by id. When watchedSymbolIds is empty, only AllSymbols are
   * considered (a Symbol-scoped rule can't fire if its symbol isn't watched
   * — the bridges in #392 keep the watchlist consistent with the data
   * stream).
   * Upgrade path: a single `listAllEnabled(profileId)` repo method when
   * watchlist sizes outgrow the loop cost.
   */
  private async allEnabledAcrossScopes(
    profileId: string | undefined,
    watchedSymbolIds: readonly string[] | undefined,
  ): Promise<Rule[]> {
    const byId = new Map<string, Rule>();
    for (const rule of await this.deps.rules.listEnabledForSymbol(null, profileId)) {
      byId.set(rule.id, rule);
    }
    for (const symbolId of watchedSymbolIds ?? []) {
      for (const rule of await this.deps.rules.listEnabledForSymbol(symbolId, profileId)) {
        byId.set(rule.id, rule);
      }
    }
    return [...byId.values()].sort((a, b) => a.order - b.order);
  }
}

/** Composite key for the OncePerBar latch / OncePerInterval timestamps. */
const LATCH_KEY_SEP = '|';

function latchKey(ruleId: string, firingSymbolId: string, period?: string): string {
  return period === undefined
    ? `${ruleId}${LATCH_KEY_SEP}${firingSymbolId}`
    : `${ruleId}${LATCH_KEY_SEP}${firingSymbolId}${LATCH_KEY_SEP}${period}`;
}

function keyHasPeriod(key: string, period: string): boolean {
  return key.endsWith(`${LATCH_KEY_SEP}${period}`);
}

/** Whether the event carries a symbol (i.e. is symbol-scoped). */
function symbolIdOf(event: EvaluationTriggerEvent): string | null {
  if (
    event.kind === EvaluationTriggerKind.Tick ||
    event.kind === EvaluationTriggerKind.BarOpened ||
    event.kind === EvaluationTriggerKind.BarClosed ||
    event.kind === EvaluationTriggerKind.SymbolStateChanged ||
    event.kind === EvaluationTriggerKind.IndicatorChanged
  ) {
    return event.symbolId;
  }
  return null;
}

/** Whether the event is one of the three cascade kinds. */
function isCascadeEvent(
  event: EvaluationTriggerEvent,
): event is SymbolStateChangedEvent | GlobalStateChangedEvent | IndicatorChangedEvent {
  return (
    event.kind === EvaluationTriggerKind.SymbolStateChanged ||
    event.kind === EvaluationTriggerKind.GlobalStateChanged ||
    event.kind === EvaluationTriggerKind.IndicatorChanged
  );
}

/** Whether `event` is an evaluation-trigger event (not a data-update event). */
function isEvaluationTriggerEvent(event: RuleEvent): event is EvaluationTriggerEvent {
  return (
    event.kind === EvaluationTriggerKind.Tick ||
    event.kind === EvaluationTriggerKind.BarOpened ||
    event.kind === EvaluationTriggerKind.BarClosed ||
    event.kind === EvaluationTriggerKind.Timer ||
    event.kind === EvaluationTriggerKind.SymbolStateChanged ||
    event.kind === EvaluationTriggerKind.GlobalStateChanged ||
    event.kind === EvaluationTriggerKind.IndicatorChanged
  );
}

/**
 * Which symbol(s) the rule fires on for this event — fan-out by scope:
 *
 * - `Symbol` — always on `scope.symbolId`.
 * - `Symbols` — on every id in `scope.symbolIds` for a symbol-less event;
 *   for an event with a symbol, on that single symbol if it's in the list.
 * - `AllSymbols` — on the event's symbol when present; otherwise on every
 *   id in `options.watchedSymbolIds` (the orchestrator's watchlist).
 */
function firingSymbolsFor(
  rule: Rule,
  event: EvaluationTriggerEvent,
  options: DispatchOptions,
): string[] {
  const eventSymbol = symbolIdOf(event);
  switch (rule.scope.kind) {
    case RuleScopeKind.Symbol:
      return [rule.scope.symbolId];
    case RuleScopeKind.Symbols:
      if (eventSymbol === null) return [...rule.scope.symbolIds];
      return rule.scope.symbolIds.includes(eventSymbol) ? [eventSymbol] : [];
    case RuleScopeKind.AllSymbols:
      if (eventSymbol !== null) return [eventSymbol];
      return [...(options.watchedSymbolIds ?? [])];
  }
}
