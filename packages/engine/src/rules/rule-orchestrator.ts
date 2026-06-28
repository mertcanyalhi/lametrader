import {
  type EventLog,
  type Rule,
  type RuleEvent,
  type RuleEventEntry,
  RuleEventKind,
  RuleEventType,
  type RuleRepository,
  RuleScopeKind,
  type StateChangedEvent,
  type StateRepository,
  StateScope,
  TriggerKind,
  type WatchlistRepository,
} from '@lametrader/core';
import { getLogger } from '../log.js';
import type { ActionRunner } from './action-runner.js';
import { evaluateCondition } from './condition-evaluator.js';
import { CycleGuard, CycleOverflowError } from './cycle-guard.js';
import { buildEvaluationContext } from './evaluation-context.js';
import type { EvaluationContext, EvaluationLookups } from './evaluation-context.types.js';
import { RuleOutcome } from './rule-orchestrator-trace.types.js';
import type { TriggerEvaluator } from './trigger-evaluator.js';

/** Scope-bound logger for the rule orchestrator (#306). */
const log = getLogger('rule-orchestrator');

/** Options for {@link RuleOrchestrator}. */
export interface RuleOrchestratorOptions {
  /** Maximum cascading state-change re-entries per tick. Default `4`. */
  cycleLimit?: number;
}

/**
 * One inbound or cascaded event waiting in the orchestrator's per-tick
 * queue, carrying the cascade-depth and originating-rule provenance the
 * trace logging surfaces (#354).
 */
interface QueuedEvent {
  /** The event itself. */
  event: RuleEvent;
  /** `0` for the inbound event; `≥ 1` for each cascade hop. */
  cascadeDepth: number;
  /** The rule whose state-write enqueued this event; `undefined` on the inbound. */
  triggeredByRuleId: string | undefined;
}

/**
 * Top-level rule engine entry point.
 *
 * Per inbound {@link RuleEvent}:
 *
 * 1. Loads enabled rules matching the affected symbol (or all symbols), in
 *    `order`.
 * 2. For each rule: skips expired (emitting one `Expired` event on the first
 *    skip per symbol), builds an {@link EvaluationContext}, evaluates the
 *    condition tree, runs the trigger gate, and — if every gate is clear —
 *    executes each action, appending the matching rule-event entries.
 * 3. State mutations made by actions re-enter the loop in the same tick via
 *    a {@link StateRepository.onStateChanged} subscription, bounded by a
 *    {@link CycleGuard}.
 * 4. A cycle overflow stops further cascading and records exactly one
 *    `CycleOverflow` rule event.
 *
 * Lazy-but-functional: this covers the core loop plus AllSymbols Timer
 * fan-out across every watched symbol and profile-aware rule filtering.
 * Indicator subscription wiring lands in a later issue.
 */
export class RuleOrchestrator {
  /**
   * The rule currently in {@link fire}, or `undefined` outside it. Read by
   * the `state.onStateChanged` subscriber so cascaded events carry their
   * originating `triggeredByRuleId` into the trace payload (#354).
   */
  private currentFiringRuleId: string | undefined;

  constructor(
    private readonly rules: RuleRepository,
    private readonly watchlist: WatchlistRepository,
    private readonly lookups: EvaluationLookups,
    private readonly state: StateRepository,
    private readonly log: EventLog,
    private readonly triggers: TriggerEvaluator,
    private readonly actions: ActionRunner,
    private readonly options: RuleOrchestratorOptions = {},
  ) {}

  /**
   * Drive one external event through the engine; returns when the tick's
   * queue (including any cascaded state events) is fully drained or the
   * cycle limit is breached.
   */
  async process(initialEvent: RuleEvent): Promise<void> {
    const guard = new CycleGuard(this.options.cycleLimit ?? 4);
    const cascaded: Array<{ event: RuleEvent; triggeredByRuleId: string | undefined }> = [];
    const unsubscribe = this.state.onStateChanged((event) => {
      cascaded.push({
        event: toRuleEvent(event),
        triggeredByRuleId: this.currentFiringRuleId,
      });
    });
    try {
      const queue: QueuedEvent[] = [
        { event: initialEvent, cascadeDepth: 0, triggeredByRuleId: undefined },
      ];
      while (queue.length > 0) {
        const next = queue.shift() as QueuedEvent;
        if (next.cascadeDepth > 0) {
          try {
            guard.enter();
          } catch (error) {
            if (error instanceof CycleOverflowError) {
              await this.recordCycleOverflow(next.event, error.limit);
              return;
            }
            throw error;
          }
        }
        log.trace(
          {
            cascadeDepth: next.cascadeDepth,
            ...(next.triggeredByRuleId !== undefined
              ? { triggeredByRuleId: next.triggeredByRuleId }
              : {}),
            eventKind: next.event.kind,
            eventTs: next.event.ts,
            eventTime: new Date(next.event.ts).toISOString(),
            symbolId: next.event.symbolId,
            eventPayload: next.event,
          },
          'event_received',
        );
        await this.processOneEvent(next.event);
        for (const c of cascaded.splice(0)) {
          queue.push({
            event: c.event,
            cascadeDepth: next.cascadeDepth + 1,
            triggeredByRuleId: c.triggeredByRuleId,
          });
        }
      }
    } finally {
      unsubscribe();
    }
  }

  /**
   * Process one event against every matching enabled rule.
   *
   * For cascaded state-change events (which carry their originating
   * `profileId` per #281), the profile is taken from the event itself so a
   * profile-A write never wakes profile-B rules.
   * For all other events, every enabled profile's rules are candidates
   * (multi-profile fire is the default; #290 — no active-profile concept).
   *
   * The repository's `listEnabledForSymbol` enforces both the rule's own
   * `enabled` flag and the parent profile's `enabled` flag.
   */
  private async processOneEvent(event: RuleEvent): Promise<void> {
    const profileId = this.resolveProfileIdForEvent(event);
    const enabled = await this.rules.listEnabledForSymbol(event.symbolId, profileId);
    enabled.sort((a, b) => a.order - b.order);
    for (const rule of enabled) {
      await this.processRule(rule, event);
    }
  }

  /**
   * Pick the `profileId` filter for `event`'s evaluation. Cascaded state
   * changes carry their originating profile on the event itself (#281); other
   * events have no profile filter and every enabled profile's rules are
   * candidates (#290).
   */
  private resolveProfileIdForEvent(event: RuleEvent): string | undefined {
    if (
      event.kind === RuleEventKind.SymbolStateChanged ||
      event.kind === RuleEventKind.GlobalStateChanged
    ) {
      return event.profileId;
    }
    return undefined;
  }

  /**
   * Evaluate one rule against one event and fire it if every gate passes.
   * AllSymbols-scoped rules whose event has no `symbolId` fan out across
   * every watched symbol, firing once per (rule, symbol).
   */
  private async processRule(rule: Rule, event: RuleEvent): Promise<void> {
    const firingSymbolIds = await this.firingSymbolsFor(rule, event);
    for (const firingSymbolId of firingSymbolIds) {
      const didFire = await this.processRuleForSymbol(rule, event, firingSymbolId);
      // A `Once` trigger is meant to fire a single time. Auto-disable on the
      // first fire so the user sees the rule as inactive without having to
      // flip the toggle themselves. For an AllSymbols-scoped Once, this stops
      // the fan-out at the first match (any remaining symbols stay un-fired).
      // Reload before save: `fire()` has just $push-ed a `Fired` entry onto
      // the rule doc (per the Mongo `EventLog` adapter); saving the stale
      // captured `rule` would replaceOne it back to its pre-fire state and
      // wipe the entry. See issue #300.
      if (didFire && rule.trigger.kind === TriggerKind.Once) {
        const fresh = await this.rules.get(rule.id);
        if (fresh !== null) await this.rules.save({ ...fresh, enabled: false });
        log.warn(
          {
            ruleId: rule.id,
            symbolId: firingSymbolId,
            ts: event.ts,
            eventTime: new Date(event.ts).toISOString(),
          },
          'auto-disabled Once rule after fire',
        );
        return;
      }
    }
  }

  /**
   * Evaluate one rule against one event for one firing symbol. Returns `true`
   * if the rule's actions actually fired (so the caller can disable a `Once`
   * trigger after its first fire); `false` for any skip — expired, condition
   * false, or the trigger gate suppressed it.
   */
  private async processRuleForSymbol(
    rule: Rule,
    event: RuleEvent,
    firingSymbolId: string,
  ): Promise<boolean> {
    const eventTime = new Date(event.ts).toISOString();
    log.trace({ ruleId: rule.id, ruleName: rule.name, firingSymbolId, eventTime }, 'rule_starting');
    if (rule.expiration !== null && event.ts >= rule.expiration.at) {
      await this.maybeEmitExpired(rule, firingSymbolId, event.ts);
      log.trace({ ruleId: rule.id, outcome: RuleOutcome.Expired, eventTime }, 'rule_summary');
      return false;
    }

    const context = buildEvaluationContext(event, this.lookups, rule.profileId, firingSymbolId);
    const conditionTrue = evaluateCondition(rule.condition, context, rule.id);

    const triggerAllows = await this.triggers.mayFire(rule, event, firingSymbolId, conditionTrue);

    if (!conditionTrue) {
      log.trace(
        { ruleId: rule.id, outcome: RuleOutcome.ConditionFalse, eventTime },
        'rule_summary',
      );
      return false;
    }
    if (!triggerAllows) {
      log.trace({ ruleId: rule.id, outcome: RuleOutcome.GateBlocked, eventTime }, 'rule_summary');
      return false;
    }

    await this.fire(rule, firingSymbolId, event.ts, context);
    log.trace({ ruleId: rule.id, outcome: RuleOutcome.Fired, eventTime }, 'rule_summary');
    return true;
  }

  /**
   * Execute every action on a rule, then append the rule-event entries it
   * produces (one per action, plus the trailing `Fired` umbrella).
   *
   * Sets {@link currentFiringRuleId} for the duration so the `onStateChanged`
   * subscriber tags any cascaded event with `triggeredByRuleId = rule.id`
   * (#354).
   */
  private async fire(
    rule: Rule,
    firingSymbolId: string,
    ts: number,
    context: EvaluationContext,
  ): Promise<void> {
    this.currentFiringRuleId = rule.id;
    try {
      const entries = await this.actions.run(rule, firingSymbolId, ts, context);
      for (const entry of entries) {
        await this.log.appendRuleEvent(rule.id, entry);
        await this.log.appendSymbolEvent(firingSymbolId, entry);
      }
    } finally {
      this.currentFiringRuleId = undefined;
    }
  }

  /**
   * Determine which symbol(s) the rule fires on for `event`.
   *
   * - Symbol-scoped rules always fire on `rule.scope.symbolId`.
   * - AllSymbols-scoped rules fire on the event's `symbolId` when present.
   * - AllSymbols-scoped rules on a symbol-less event (TimerEvent /
   *   GlobalStateChanged) fan out across every watched symbol.
   */
  private async firingSymbolsFor(rule: Rule, event: RuleEvent): Promise<string[]> {
    if (rule.scope.kind === RuleScopeKind.Symbol) return [rule.scope.symbolId];
    if (event.symbolId !== null) return [event.symbolId];
    const watched = await this.watchlist.list();
    return watched.map((s) => s.id);
  }

  /**
   * Emit one `Expired` event per (rule, symbol); subsequent skips are
   * silent.
   */
  private async maybeEmitExpired(rule: Rule, symbolId: string, ts: number): Promise<void> {
    const events = await this.log.ruleEvents(rule.id);
    for (const event of events) {
      if (event.type === RuleEventType.Expired && event.symbolId === symbolId) return;
    }
    const entry: RuleEventEntry = {
      type: RuleEventType.Expired,
      ts,
      ruleId: rule.id,
      symbolId,
    };
    await this.log.appendRuleEvent(rule.id, entry);
    await this.log.appendSymbolEvent(symbolId, entry);
  }

  /**
   * Append exactly one `CycleOverflow` event for the inbound event that
   * pushed the cycle past the limit.
   */
  private async recordCycleOverflow(event: RuleEvent, limit: number): Promise<void> {
    const symbolId = event.symbolId ?? '';
    const entry: RuleEventEntry = {
      type: RuleEventType.CycleOverflow,
      ts: event.ts,
      ruleId: '',
      symbolId,
      cycleLimit: limit,
    };
    await this.log.appendSymbolEvent(symbolId, entry);
  }
}

/**
 * Translate one {@link StateChangedEvent} from the repository into the
 * matching {@link RuleEvent} variant the orchestrator iterates.
 *
 * Carries `profileId` through so the cascaded rule event only fires
 * same-profile candidates (#281).
 */
function toRuleEvent(event: StateChangedEvent): RuleEvent {
  if (event.scope.kind === StateScope.Symbol) {
    return {
      kind: RuleEventKind.SymbolStateChanged,
      ts: event.ts,
      symbolId: event.scope.symbolId,
      profileId: event.profileId,
      key: event.key,
      prev: event.prev,
      current: event.current,
    };
  }
  return {
    kind: RuleEventKind.GlobalStateChanged,
    ts: event.ts,
    symbolId: null,
    profileId: event.profileId,
    key: event.key,
    prev: event.prev,
    current: event.current,
  };
}
