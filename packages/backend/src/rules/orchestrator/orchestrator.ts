import {
  type EvaluationTriggerEvent,
  EvaluationTriggerKind,
  type EventLog,
  type GlobalStateChangedEvent,
  type RuleEvent,
  type RuleEventEntry,
  RuleEventType,
  type RuleRepository,
  type StateRepository,
  type SymbolStateChangedEvent,
  type WatchlistRepository,
} from '@lametrader/core';
import { StateCascadeBridge } from '../bridges/state-cascade-bridge.js';
import type { TriggerDispatcher } from '../dispatch/dispatcher.js';
import { TickRuleCache } from '../dispatch/tick-rule-cache.js';
import { getLogger } from '../engine-log.js';
import type { ActionRunner } from './action-runner.js';
import { CycleGuard, CycleOverflowError } from './cycle-guard.js';
import { RuleOutcome } from './orchestrator-trace.types.js';

/**
 * Scope-bound logger for the rule orchestrator.
 *
 * Sits under `engine.rules.orchestrator` so a single `engine.rules.*:trace`
 * setting enables every rules-engine surface together (per #436).
 */
const log = getLogger('engine.rules.orchestrator');

/** Default cycle limit (cascading state-change re-entries per tick). */
const DEFAULT_CYCLE_LIMIT = 4;

/**
 * Dependencies the {@link RuleOrchestrator} composes — every collaborator
 * passed by interface so the unit tier can swap in fakes.
 */
export interface RuleOrchestratorDeps {
  /** Rule repository — read for fan-out targets, written for `Once` auto-disable. */
  rules: RuleRepository;
  /** State repository — written by mutation actions; subscribed for cascades. */
  state: StateRepository;
  /** Watchlist — drives `AllSymbols` fan-out on symbol-less events. */
  watchlist: WatchlistRepository;
  /** Pure dispatcher that returns the rules to fire for an event. */
  dispatcher: TriggerDispatcher;
  /** Action runner that executes one fire and returns the rule-event entries. */
  actions: ActionRunner;
  /** Event log the orchestrator appends to (rule + symbol log per fire). */
  eventLog: EventLog;
}

/** Optional knobs the orchestrator accepts on construction. */
export interface RuleOrchestratorOptions {
  /**
   * Maximum cascading state-change re-entries per tick.
   * Default: {@link DEFAULT_CYCLE_LIMIT}.
   */
  cycleLimit?: number;
}

/**
 * Top-level rule engine entry point.
 *
 * Per inbound {@link EvaluationTriggerEvent}:
 *
 * 1. Asks the dispatcher to route the event to candidate rules and run the
 *    per-trigger gate (`EveryTime` / `Once` / `OncePerBar*` / `OncePerInterval`).
 *    The dispatcher owns condition evaluation, scope expansion
 *    (`AllSymbols` / `Symbols` / `Symbol`), profile filter (#281 / #290), and
 *    the `Once` auto-disable persist.
 * 2. For each returned {@link FireRecord}, runs the rule's actions through
 *    {@link ActionRunner} and appends each returned entry to both the rule's
 *    and the firing symbol's event logs.
 * 3. Cascades any {@link SymbolStateChangedEvent} /
 *    {@link GlobalStateChangedEvent} emitted during the tick back
 *    into the same drain loop, bounded by a {@link CycleGuard}.
 * 4. A cycle overflow stops further cascading and records exactly one
 *    `CycleOverflow` rule event on the affected symbol's log.
 *
 * The orchestrator emits structured trace per phase (`event_received`,
 * `rule_starting`, `rule_summary`) so live debugging surfaces the why of
 * each fire.
 */
export class RuleOrchestrator {
  /** Cycle limit reused across every {@link process} invocation. */
  private readonly cycleLimit: number;

  constructor(
    private readonly deps: RuleOrchestratorDeps,
    options: RuleOrchestratorOptions = {},
  ) {
    this.cycleLimit = options.cycleLimit ?? DEFAULT_CYCLE_LIMIT;
  }

  /**
   * Drive one external event through the engine; returns when the tick's
   * queue (including any cascaded state events) is fully drained or the
   * cycle limit is breached.
   */
  async process(initialEvent: EvaluationTriggerEvent): Promise<void> {
    const guard = new CycleGuard(this.cycleLimit);
    // One rule-list cache spans the whole tick (initial event + cascades), so
    // repeated (symbolId, profileId) lookups hit it instead of re-querying.
    const ruleListCache = new TickRuleCache(this.deps.rules);
    const cascaded: EvaluationTriggerEvent[] = [];
    const bridge = new StateCascadeBridge((event) => cascaded.push(event));
    const unsubscribe = this.deps.state.onStateChanged((event) => bridge.handleStateChange(event));
    try {
      const queue: Array<{ event: EvaluationTriggerEvent; cascadeDepth: number }> = [
        { event: initialEvent, cascadeDepth: 0 },
      ];
      while (queue.length > 0) {
        const next = queue.shift() as {
          event: EvaluationTriggerEvent;
          cascadeDepth: number;
        };
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
        await this.processOneEvent(next.event, ruleListCache);
        for (const c of cascaded.splice(0)) {
          queue.push({ event: c, cascadeDepth: next.cascadeDepth + 1 });
        }
      }
    } finally {
      unsubscribe();
    }
  }

  /**
   * Process one event through the dispatcher and run each returned fire.
   */
  private async processOneEvent(
    event: EvaluationTriggerEvent,
    ruleListCache: TickRuleCache,
  ): Promise<void> {
    const watchedSymbolIds = await this.watchedSymbolIds(event);
    const fires = await this.deps.dispatcher.dispatch(event, { watchedSymbolIds, ruleListCache });
    for (const fire of fires) {
      await this.runOneFire(fire, event);
    }
  }

  /**
   * Look up the watched symbol ids for AllSymbols fan-out — used by the
   * dispatcher when it sees a symbol-less event (Timer / GlobalStateChanged)
   * to expand `AllSymbols`-scoped rules to one fire per watched symbol.
   *
   * Lazy: queries every time on the symbol-less path; the in-memory
   * watchlist is sync-fast and Mongo will cache. Upgrade path: hoist the
   * lookup to a cache invalidated on watchlist `onChange`.
   */
  private async watchedSymbolIds(
    event: EvaluationTriggerEvent,
  ): Promise<readonly string[] | undefined> {
    if (
      event.kind !== EvaluationTriggerKind.Timer &&
      event.kind !== EvaluationTriggerKind.GlobalStateChanged
    ) {
      return undefined;
    }
    const watched = await this.deps.watchlist.list();
    return watched.map((s) => s.id);
  }

  /**
   * Execute one rule's actions on one firing symbol, log entries to both the
   * rule's and symbol's event log, and emit the `rule_summary` trace.
   */
  private async runOneFire(
    fire: { ruleId: string; firingSymbolId: string; event: RuleEvent },
    inboundEvent: EvaluationTriggerEvent,
  ): Promise<void> {
    const eventTime = new Date(inboundEvent.ts).toISOString();
    const rule = await this.deps.rules.get(fire.ruleId);
    if (rule === null) {
      // The dispatcher saw the rule a moment ago; if it's gone now another
      // writer raced us — silent skip, the events log captures the lifecycle
      // separately.
      log.trace(
        { ruleId: fire.ruleId, outcome: RuleOutcome.NotFired, eventTime, reason: 'rule-missing' },
        'rule_summary',
      );
      return;
    }
    log.trace(
      { ruleId: rule.id, ruleName: rule.name, firingSymbolId: fire.firingSymbolId, eventTime },
      'rule_starting',
    );
    const entries = await this.deps.actions.run(
      rule,
      fire.firingSymbolId,
      inboundEvent.ts,
      inboundEvent,
    );
    for (const entry of entries) {
      await this.deps.eventLog.appendRuleEvent(rule.id, entry);
      await this.deps.eventLog.appendSymbolEvent(fire.firingSymbolId, entry);
    }
    await this.stampLastFiredAt(rule, inboundEvent.ts);
    log.trace({ ruleId: rule.id, outcome: RuleOutcome.Fired, eventTime }, 'rule_summary');
  }

  /**
   * Persist `lastFiredAt` on the rule after a successful fire.
   *
   * Re-reads the rule before saving so a concurrent writer (`Once`
   * auto-disable in the dispatcher, a user edit landing mid-tick) doesn't
   * lose its update. If the rule has been removed since the fire started,
   * silently skip — the event log captures the firing lifecycle separately.
   */
  private async stampLastFiredAt(rule: { id: string }, ts: number): Promise<void> {
    const fresh = await this.deps.rules.get(rule.id);
    if (fresh === null) return;
    await this.deps.rules.save({ ...fresh, lastFiredAt: ts });
  }

  /**
   * Append exactly one `CycleOverflow` event on the symbol affected by the
   * inbound event — preserves v1's "one entry per overflow" semantics.
   *
   * Cascade events all carry a symbol id (`SymbolStateChanged`) or land on
   * the global chain (`GlobalStateChanged`, no symbol — we record the
   * overflow on the empty-string symbol so the entry isn't lost).
   */
  private async recordCycleOverflow(event: EvaluationTriggerEvent, limit: number): Promise<void> {
    const symbolId = symbolIdOf(event) ?? '';
    const entry: RuleEventEntry = {
      type: RuleEventType.CycleOverflow,
      ts: event.ts,
      ruleId: '',
      symbolId,
      cycleLimit: limit,
    };
    await this.deps.eventLog.appendSymbolEvent(symbolId, entry);
  }
}

/** Whether the event carries a symbol id, returning it (or `null`). */
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
