import { Period, RulesV2, type StateRepository, type WatchlistRepository } from '@lametrader/core';

import { getLogger } from '../../log.js';
import { StateCascadeBridge } from '../bridges/state-cascade-bridge.js';
import type { TriggerDispatcher } from '../dispatch/dispatcher.js';
import { buildEvaluationContext } from '../evaluation-context.js';
import type { EvaluationContext, EvaluationLookups } from '../evaluation-context.types.js';
import { evaluateLeaf } from '../operators/dispatch.js';
import type { ActionRunner } from './action-runner.js';
import { CycleGuard, CycleOverflowError } from './cycle-guard.js';
import { RuleOutcome } from './orchestrator-trace.types.js';

/** Scope-bound logger for the v2 rule orchestrator. */
const log = getLogger('rules-v2-orchestrator');

/** Options for {@link RuleOrchestrator}. */
export interface RuleOrchestratorOptions {
  /** Maximum cascading state-change re-entries per tick. Default `4`. */
  cycleLimit?: number;
  /**
   * Fallback bar period used when neither the trigger nor the event implies
   * one (tick / Timer / cascade events on rules with leaf-level intervals
   * that the v2 context doesn't currently thread). Default {@link Period.OneMinute}.
   */
  defaultPeriod?: Period;
}

/**
 * One inbound or cascaded event waiting in the orchestrator's per-tick queue.
 * `cascadeDepth` is `0` for the inbound event and `≥ 1` for each cascade hop.
 */
interface QueuedEvent {
  /** The event itself. */
  event: RulesV2.EvaluationTriggerEvent;
  /** `0` for the inbound event; `≥ 1` for each cascade hop. */
  cascadeDepth: number;
}

/**
 * Top-level v2 rule engine entry point.
 *
 * Per inbound {@link RulesV2.EvaluationTriggerEvent}:
 *
 * 1. Loads enabled rules matching the affected symbol (or all symbols), in
 *    `order`, with profile filter applied for cascade events (#281).
 * 2. For each rule + each firing symbol it fans out to: skips expired (emits
 *    one `Expired` event on the first skip per rule+symbol), builds an
 *    {@link EvaluationContext}, evaluates the condition tree, asks the
 *    {@link TriggerDispatcher} whether the fire is allowed, and — when it is
 *    — runs the actions through the {@link ActionRunner} and appends every
 *    returned entry to the rule's and the firing symbol's events logs.
 * 3. State mutations made by actions re-enter the loop in the same tick via
 *    a {@link StateRepository.onStateChanged} subscription threaded through a
 *    {@link StateCascadeBridge}, bounded by a {@link CycleGuard}.
 * 4. A cycle overflow stops further cascading and records exactly one
 *    `CycleOverflow` rule event.
 */
export class RuleOrchestrator {
  /** Cycle limit reused across every {@link process} invocation. */
  private readonly cycleLimit: number;
  /** Fallback period for {@link EvaluationContext} on events with no implicit period. */
  private readonly defaultPeriod: Period;

  constructor(
    private readonly rules: RulesV2.RuleRepository,
    private readonly watchlist: WatchlistRepository,
    private readonly lookups: EvaluationLookups,
    private readonly state: StateRepository,
    private readonly eventLog: RulesV2.EventLog,
    private readonly dispatcher: TriggerDispatcher,
    private readonly actions: ActionRunner,
    options: RuleOrchestratorOptions = {},
  ) {
    this.cycleLimit = options.cycleLimit ?? 4;
    this.defaultPeriod = options.defaultPeriod ?? Period.OneMinute;
  }

  /**
   * Drive one external event through the engine; returns when the tick's
   * queue (including any cascaded state events) is fully drained or the
   * cycle limit is breached.
   */
  async process(initialEvent: RulesV2.EvaluationTriggerEvent): Promise<void> {
    const guard = new CycleGuard(this.cycleLimit);
    const cascaded: RulesV2.EvaluationTriggerEvent[] = [];
    const bridge = new StateCascadeBridge((event) => cascaded.push(event));
    const unsubscribe = this.state.onStateChanged((event) => bridge.handleStateChange(event));
    try {
      const queue: QueuedEvent[] = [{ event: initialEvent, cascadeDepth: 0 }];
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
            eventKind: next.event.kind,
            eventTs: next.event.ts,
            eventTime: new Date(next.event.ts).toISOString(),
          },
          'event_received',
        );
        if (next.event.kind === RulesV2.EvaluationTriggerKind.BarOpened) {
          this.dispatcher.onBarOpened(next.event.symbolId, next.event.period);
        }
        await this.processOneEvent(next.event);
        for (const c of cascaded.splice(0)) {
          queue.push({ event: c, cascadeDepth: next.cascadeDepth + 1 });
        }
      }
    } finally {
      unsubscribe();
    }
  }

  /**
   * Process one event against every matching enabled rule, optionally scoped
   * to the cascade's originating `profileId` (#281).
   */
  private async processOneEvent(event: RulesV2.EvaluationTriggerEvent): Promise<void> {
    const profileId = profileIdFor(event);
    const symbolId = symbolIdFor(event);
    const enabled = await this.rules.listEnabledForSymbol(symbolId, profileId);
    enabled.sort((a, b) => a.order - b.order);
    for (const rule of enabled) {
      await this.processRule(rule, event);
    }
  }

  /**
   * Evaluate one rule against one event across every firing symbol it fans
   * out to. AllSymbols / Symbols on symbol-less events fan out across the
   * watchlist / list respectively; Symbol-scoped always fires on its one id.
   */
  private async processRule(
    rule: RulesV2.Rule,
    event: RulesV2.EvaluationTriggerEvent,
  ): Promise<void> {
    const firingSymbolIds = await this.firingSymbolsFor(rule, event);
    for (const firingSymbolId of firingSymbolIds) {
      const didFire = await this.processRuleForSymbol(rule, event, firingSymbolId);
      if (didFire && rule.trigger.kind === RulesV2.TriggerKind.Once) {
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
   * iff the rule's actions ran (so the caller can disable a `Once` trigger
   * after its first fire); `false` for any skip — expired, dispatcher
   * declined.
   */
  private async processRuleForSymbol(
    rule: RulesV2.Rule,
    event: RulesV2.EvaluationTriggerEvent,
    firingSymbolId: string,
  ): Promise<boolean> {
    const eventTime = new Date(event.ts).toISOString();
    log.trace({ ruleId: rule.id, ruleName: rule.name, firingSymbolId, eventTime }, 'rule_starting');
    if (rule.expiration !== null && event.ts >= rule.expiration.at) {
      await this.maybeEmitExpired(rule, firingSymbolId, event.ts);
      log.trace({ ruleId: rule.id, outcome: RuleOutcome.Expired, eventTime }, 'rule_summary');
      return false;
    }
    const period = this.periodFor(rule, event);
    const context = buildEvaluationContext({
      event,
      profileId: rule.profileId,
      symbolId: firingSymbolId,
      lookups: this.lookups,
      defaultPeriod: period,
    });
    const conditionTrue = evaluateConditionTree(rule.condition, context);
    const allows = this.dispatcher.decide(rule, event, firingSymbolId, conditionTrue);
    if (!allows) {
      log.trace(
        { ruleId: rule.id, outcome: RuleOutcome.DispatcherDeclined, eventTime, conditionTrue },
        'rule_summary',
      );
      return false;
    }
    await this.fire(rule, firingSymbolId, event, context, period);
    log.trace({ ruleId: rule.id, outcome: RuleOutcome.Fired, eventTime }, 'rule_summary');
    return true;
  }

  /**
   * Execute every action on a rule, append the rule-event entries it
   * produces, and notify the dispatcher to update its in-memory gate state.
   */
  private async fire(
    rule: RulesV2.Rule,
    firingSymbolId: string,
    event: RulesV2.EvaluationTriggerEvent,
    context: EvaluationContext,
    snapshotPeriod: Period,
  ): Promise<void> {
    const entries = await this.actions.run({
      rule,
      firingSymbolId,
      ts: event.ts,
      context,
      snapshotPeriod,
    });
    for (const entry of entries) {
      await this.eventLog.appendRuleEvent(rule.id, entry);
      await this.eventLog.appendSymbolEvent(firingSymbolId, entry);
    }
    this.dispatcher.recordFire(rule, event, firingSymbolId);
  }

  /**
   * Determine which symbol(s) the rule fires on for `event`.
   *
   * - Symbol-scoped rules always fire on `rule.scope.symbolId`.
   * - Symbols-scoped rules fire on the event's `symbolId` when present (and
   *   only if that id is in the list); on a symbol-less event they fan out
   *   across the list.
   * - AllSymbols-scoped rules fire on the event's `symbolId` when present;
   *   on a symbol-less event they fan out across every watched symbol.
   */
  private async firingSymbolsFor(
    rule: RulesV2.Rule,
    event: RulesV2.EvaluationTriggerEvent,
  ): Promise<string[]> {
    const eventSymbolId = symbolIdFor(event);
    switch (rule.scope.kind) {
      case RulesV2.RuleScopeKind.Symbol:
        return [rule.scope.symbolId];
      case RulesV2.RuleScopeKind.Symbols:
        if (eventSymbolId !== null) {
          return rule.scope.symbolIds.includes(eventSymbolId) ? [eventSymbolId] : [];
        }
        return [...rule.scope.symbolIds];
      case RulesV2.RuleScopeKind.AllSymbols: {
        if (eventSymbolId !== null) return [eventSymbolId];
        const watched = await this.watchlist.list();
        return watched.map((s) => s.id);
      }
    }
  }

  /** Emit one `Expired` event per (rule, symbol); subsequent skips are silent. */
  private async maybeEmitExpired(rule: RulesV2.Rule, symbolId: string, ts: number): Promise<void> {
    const events = await this.eventLog.ruleEvents(rule.id);
    for (const event of events) {
      if (event.type === RulesV2.RuleEventType.Expired && event.symbolId === symbolId) return;
    }
    const entry: RulesV2.RuleEventEntry = {
      type: RulesV2.RuleEventType.Expired,
      ts,
      ruleId: rule.id,
      symbolId,
    };
    await this.eventLog.appendRuleEvent(rule.id, entry);
    await this.eventLog.appendSymbolEvent(symbolId, entry);
  }

  /**
   * Append exactly one `CycleOverflow` event for the inbound event that
   * pushed the cycle past the limit. Falls back to a placeholder `symbolId`
   * when the event itself has none (Timer / GlobalStateChanged).
   */
  private async recordCycleOverflow(
    event: RulesV2.EvaluationTriggerEvent,
    limit: number,
  ): Promise<void> {
    const symbolId = symbolIdFor(event) ?? '';
    const entry: RulesV2.RuleEventEntry = {
      type: RulesV2.RuleEventType.CycleOverflow,
      ts: event.ts,
      ruleId: '',
      symbolId,
      cycleLimit: limit,
    };
    await this.eventLog.appendSymbolEvent(symbolId, entry);
  }

  /**
   * Pick the bar period the evaluation context (and the `Fired` lookup
   * snapshot) uses for OHLCV operand resolution. Trigger period wins when
   * the trigger carries one; otherwise the event's period (for bar
   * lifecycle events); otherwise the orchestrator's fallback.
   */
  private periodFor(rule: RulesV2.Rule, event: RulesV2.EvaluationTriggerEvent): Period {
    const triggerPeriod = periodOfTrigger(rule.trigger);
    if (triggerPeriod !== null) return triggerPeriod;
    const eventPeriod = periodOfEvent(event);
    if (eventPeriod !== null) return eventPeriod;
    return this.defaultPeriod;
  }
}

/**
 * Walk the v2 condition tree against `ctx`, returning the boolean truth of
 * its leaves combined under AND / OR semantics.
 *
 * Mirrors v1's evaluator: AND short-circuits on the first `false` child; OR
 * short-circuits on the first `true` child; an empty AND is vacuously `true`;
 * an empty OR is vacuously `false`.
 */
function evaluateConditionTree(node: RulesV2.ConditionNode, ctx: EvaluationContext): boolean {
  switch (node.kind) {
    case RulesV2.ConditionNodeKind.Leaf:
      return evaluateLeaf(node.leaf, ctx);
    case RulesV2.ConditionNodeKind.And:
      for (const child of node.children) {
        if (!evaluateConditionTree(child, ctx)) return false;
      }
      return true;
    case RulesV2.ConditionNodeKind.Or:
      for (const child of node.children) {
        if (evaluateConditionTree(child, ctx)) return true;
      }
      return false;
  }
}

/**
 * Extract the cascade-scope `profileId` from `event` when it's a state-change
 * variant (per #281); other events have no profile filter.
 */
function profileIdFor(event: RulesV2.EvaluationTriggerEvent): string | undefined {
  if (
    event.kind === RulesV2.EvaluationTriggerKind.SymbolStateChanged ||
    event.kind === RulesV2.EvaluationTriggerKind.GlobalStateChanged ||
    event.kind === RulesV2.EvaluationTriggerKind.IndicatorChanged
  ) {
    return event.kind === RulesV2.EvaluationTriggerKind.IndicatorChanged
      ? undefined
      : event.profileId;
  }
  return undefined;
}

/**
 * Extract the affected `symbolId` from `event`, or `null` for variants that
 * carry none (Timer / GlobalStateChanged).
 */
function symbolIdFor(event: RulesV2.EvaluationTriggerEvent): string | null {
  return 'symbolId' in event ? event.symbolId : null;
}

/** The bar period a trigger fires on, or `null` for periodless triggers. */
function periodOfTrigger(trigger: RulesV2.Trigger): Period | null {
  switch (trigger.kind) {
    case RulesV2.TriggerKind.OncePerBar:
    case RulesV2.TriggerKind.OncePerBarOpen:
    case RulesV2.TriggerKind.OncePerBarClose:
      return trigger.period;
    case RulesV2.TriggerKind.EveryTime:
    case RulesV2.TriggerKind.Once:
    case RulesV2.TriggerKind.OncePerInterval:
      return null;
  }
}

/** The bar period implied by an event, or `null` when none. */
function periodOfEvent(event: RulesV2.EvaluationTriggerEvent): Period | null {
  if (
    event.kind === RulesV2.EvaluationTriggerKind.BarOpened ||
    event.kind === RulesV2.EvaluationTriggerKind.BarClosed
  ) {
    return event.period;
  }
  return null;
}
