import {
  ActionKind,
  type ConditionNode,
  type EventLog,
  type FiredRuleEvent,
  type FiringStateRepository,
  type Notifier,
  NumericOperator,
  type Rule,
  type RuleEvent,
  type RuleEventContext,
  type RuleEventEntry,
  RuleEventKind,
  type RuleEventLookupSnapshot,
  RuleEventType,
  type RuleRepository,
  RuleScopeKind,
  type StateChangedEvent,
  type StateOperator,
  type StateRepository,
  StateScope,
  type Trigger,
  TriggerKind,
  type WatchlistRepository,
} from '@lametrader/core';
import { getLogger } from '../log.js';
import { type ComparisonOperator, evaluateComparison } from './comparison-evaluator.js';
import { evaluateConditionTree } from './condition-tree-evaluator.js';
import { type CrossingOperator, evaluateCrossing } from './crossing-evaluator.js';
import { CycleGuard, CycleOverflowError } from './cycle-guard.js';
import { buildEvaluationContext } from './evaluation-context.js';
import type { EvaluationContext, EvaluationLookups } from './evaluation-context.types.js';
import { appendStateActionEvent } from './event-appender.js';
import { mayFireOncePerBar, mayFireOncePerBarClose } from './once-per-bar-trigger-gate.js';
import { mayFireOncePerMinute } from './once-per-minute-trigger-gate.js';
import { mayFireOnce } from './once-trigger-gate.js';
import { executeStateAction, type StateMutationAction } from './state-action-executor.js';
import { evaluateState } from './state-evaluator.js';
import { executeTelegramAction } from './telegram-action-executor.js';

/** Scope-bound logger for the rule orchestrator (#306). */
const log = getLogger('rule-orchestrator');

/** Options for {@link RuleOrchestrator}. */
export interface RuleOrchestratorOptions {
  /** Maximum cascading state-change re-entries per tick. Default `4`. */
  cycleLimit?: number;
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
  constructor(
    private readonly rules: RuleRepository,
    private readonly watchlist: WatchlistRepository,
    private readonly lookups: EvaluationLookups,
    private readonly state: StateRepository,
    private readonly notifier: Notifier,
    private readonly log: EventLog,
    private readonly firingState: FiringStateRepository,
    private readonly options: RuleOrchestratorOptions = {},
  ) {}

  /**
   * Drive one external event through the engine; returns when the tick's
   * queue (including any cascaded state events) is fully drained or the
   * cycle limit is breached.
   */
  async process(initialEvent: RuleEvent): Promise<void> {
    const guard = new CycleGuard(this.options.cycleLimit ?? 4);
    const cascaded: RuleEvent[] = [];
    const unsubscribe = this.state.onStateChanged((event) => {
      cascaded.push(toRuleEvent(event));
    });
    try {
      const queue: RuleEvent[] = [initialEvent];
      let isFirst = true;
      while (queue.length > 0) {
        const event = queue.shift() as RuleEvent;
        if (!isFirst) {
          try {
            guard.enter();
          } catch (error) {
            if (error instanceof CycleOverflowError) {
              await this.recordCycleOverflow(event, error.limit);
              return;
            }
            throw error;
          }
        }
        isFirst = false;
        await this.processOneEvent(event);
        queue.push(...cascaded.splice(0));
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
          { ruleId: rule.id, symbolId: firingSymbolId, ts: event.ts },
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
    if (rule.expiration !== null && event.ts >= rule.expiration.at) {
      await this.maybeEmitExpired(rule, firingSymbolId, event.ts);
      return false;
    }

    const context = buildEvaluationContext(event, this.lookups, rule.profileId, firingSymbolId);
    const conditionTrue = evaluateConditionTree(rule.condition, (leaf) =>
      evaluateLeaf(leaf, context),
    );

    const events = await this.log.ruleEvents(rule.id);
    const prevActive = await this.firingState.getActive(rule.id, firingSymbolId);
    const triggerAllows = this.checkTrigger(
      rule.trigger,
      events,
      firingSymbolId,
      event.ts,
      prevActive,
      conditionTrue,
      eventFinal(event),
    );
    await this.firingState.setActive(rule.id, firingSymbolId, conditionTrue);

    if (!conditionTrue || !triggerAllows) return false;

    await this.fire(rule, firingSymbolId, event.ts, context);
    return true;
  }

  /**
   * Execute every action on a rule, append the per-action event entries,
   * then append the umbrella `Fired` event.
   */
  private async fire(
    rule: Rule,
    firingSymbolId: string,
    ts: number,
    context: EvaluationContext,
  ): Promise<void> {
    for (const action of rule.actions) {
      if (isStateAction(action)) {
        await executeStateAction(action, rule.profileId, firingSymbolId, ts, this.state);
        await appendStateActionEvent(action, rule.id, firingSymbolId, ts, this.log);
        continue;
      }
      if (action.kind === ActionKind.NotifyTelegram) {
        await executeTelegramAction(
          action,
          context,
          rule.id,
          firingSymbolId,
          ts,
          this.notifier,
          this.log,
        );
      }
    }
    const fired: FiredRuleEvent = {
      type: RuleEventType.Fired,
      ts,
      ruleId: rule.id,
      symbolId: firingSymbolId,
      context: this.captureContext(context.event, firingSymbolId),
    };
    await this.log.appendRuleEvent(rule.id, fired);
    await this.log.appendSymbolEvent(firingSymbolId, fired);
  }

  /**
   * Snapshot the inbound event and the firing symbol's OHLCV lookups —
   * the "why did this fire here?" payload persisted alongside the
   * {@link FiredRuleEvent} entry (#304).
   */
  private captureContext(inboundEvent: RuleEvent, firingSymbolId: string): RuleEventContext {
    const lookupSnapshot: RuleEventLookupSnapshot = {
      current: this.lookups.getCurrentValue(firingSymbolId),
      open: this.lookups.getOpenValue(firingSymbolId),
      high: this.lookups.getHighValue(firingSymbolId),
      low: this.lookups.getLowValue(firingSymbolId),
      close: this.lookups.getCloseValue(firingSymbolId),
      volume: this.lookups.getVolumeValue(firingSymbolId),
    };
    return { inboundEvent, lookupSnapshot };
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
   * Dispatch on `trigger.kind` to the right gate; `OncePerMinute` and the
   * bar-based variants need extra context which is threaded in here.
   */
  private checkTrigger(
    trigger: Trigger,
    events: RuleEventEntry[],
    symbolId: string,
    ts: number,
    prevActive: boolean,
    nowActive: boolean,
    final: boolean,
  ): boolean {
    switch (trigger.kind) {
      case TriggerKind.Once:
        return mayFireOnce(events, symbolId);
      case TriggerKind.OncePerBar:
        return mayFireOncePerBar(events, symbolId, ts, trigger.period);
      case TriggerKind.OncePerBarClose:
        return mayFireOncePerBarClose(events, symbolId, ts, trigger.period, final);
      case TriggerKind.OncePerMinute:
        return mayFireOncePerMinute(
          events,
          symbolId,
          ts,
          trigger.intervalMs,
          prevActive,
          nowActive,
        );
    }
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
 * Whether the inbound event represents a final bar; only OHLCV events carry
 * `final` (non-OHLCV events read as forming).
 */
function eventFinal(event: RuleEvent): boolean {
  if ('final' in event) return event.final;
  return false;
}

/**
 * Narrow `Action` to the state-mutation subset the {@link executeStateAction}
 * helper consumes.
 */
function isStateAction(action: { kind: ActionKind }): action is StateMutationAction {
  return (
    action.kind === ActionKind.SetSymbolState ||
    action.kind === ActionKind.SetGlobalState ||
    action.kind === ActionKind.RemoveSymbolState ||
    action.kind === ActionKind.RemoveGlobalState
  );
}

/**
 * Evaluate one condition-tree leaf against the context — dispatches on the
 * leaf operator's category (comparison / crossing / state).
 *
 * Lazy: crossing/state operators use `context.prev` and `context.current` as
 * the left operand's prev/current — accurate for change-triggered rules
 * where the leaf's `left` corresponds to the event's "value axis".
 */
function evaluateLeaf(
  leaf:
    | Extract<ConditionNode, { kind: never } extends never ? never : never>
    | {
        operator: ComparisonOperator | CrossingOperator | StateOperator;
        left: Parameters<EvaluationContext['resolve']>[0];
        right: Parameters<EvaluationContext['resolve']>[0];
      },
  context: EvaluationContext,
): boolean {
  const op = leaf.operator;
  const left = context.resolve(leaf.left);
  const right = context.resolve(leaf.right);
  if (isComparisonOp(op)) return evaluateComparison(op, left, right);
  if (isCrossingOp(op)) return evaluateCrossing(op, context.prev, left, right, right);
  return evaluateState(op, context.prev, left, right);
}

const COMPARISON_OPS = new Set<string>([
  NumericOperator.Gt,
  NumericOperator.Lt,
  NumericOperator.Gte,
  NumericOperator.Lte,
  NumericOperator.Eq,
  NumericOperator.Neq,
]);

const CROSSING_OPS = new Set<string>([
  NumericOperator.Crossing,
  NumericOperator.CrossingUp,
  NumericOperator.CrossingDown,
]);

function isComparisonOp(op: string): op is ComparisonOperator {
  return COMPARISON_OPS.has(op);
}

function isCrossingOp(op: string): op is CrossingOperator {
  return CROSSING_OPS.has(op);
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
