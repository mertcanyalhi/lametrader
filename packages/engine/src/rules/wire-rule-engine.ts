import type {
  EventLog,
  FiringStateRepository,
  Notifier,
  RuleEvent,
  RuleRepository,
  StateRepository,
  WatchlistRepository,
} from '@lametrader/core';

import { CandleRuleEventBridge } from './candle-rule-event-bridge.js';
import { type CascadeErrorLogger, handleCascadeError } from './cascade-error-handler.js';
import { IndicatorRuleEventBridge } from './indicator-rule-event-bridge.js';
import { LiveEvaluationLookups } from './live-evaluation-lookups.js';
import { QuoteRuleEventBridge } from './quote-rule-event-bridge.js';
import { RuleOrchestrator } from './rule-orchestrator.js';

/**
 * Dependencies the {@link wireRuleEngine} helper composes into a live rule
 * chain (#290).
 */
export interface RuleEngineDeps {
  /** Rule repository the orchestrator queries on each inbound event. */
  rules: RuleRepository;
  /** Watchlist repository for `AllSymbols`-scoped fan-out. */
  watchlist: WatchlistRepository;
  /** State repository the orchestrator writes through. */
  state: StateRepository;
  /** Notifier action sink. */
  notifier: Notifier;
  /** Event log the orchestrator and cascade error handler write to. */
  eventLog: EventLog;
  /** Firing-state repository owning per-`(ruleId, symbolId)` trigger latches. */
  firingState: FiringStateRepository;
  /** Logger used for cascade errors and stream swallowed errors. */
  logger: CascadeErrorLogger;
}

/**
 * The composed rule chain returned by {@link wireRuleEngine}.
 *
 * Callers wire each bridge's `handle*` method into the matching upstream
 * stream service (poll → `candleBridge`, indicator state →
 * `indicatorBridge`, quote → `quoteBridge`).
 */
export interface WiredRuleEngine {
  /** Bridge consuming raw {@link CandleEvent}s from the polling loop. */
  candleBridge: CandleRuleEventBridge;
  /** Bridge consuming indicator stream events. */
  indicatorBridge: IndicatorRuleEventBridge;
  /** Bridge consuming quote stream events. */
  quoteBridge: QuoteRuleEventBridge;
  /** The live evaluation lookups (kept warm by bridge events + state mirror). */
  lookups: LiveEvaluationLookups;
  /**
   * Wait until the serialized rule chain is fully drained.
   *
   * Tests call this after pushing events through to assert end-state; in
   * production it's unused (the chain drains on its own).
   */
  drain(): Promise<void>;
}

/**
 * Compose the orchestrator + three bridges + cascade error handler into a
 * single live rule chain (#290). The returned bridges plug straight into
 * the polling and stream services' fan-outs.
 */
export function wireRuleEngine(deps: RuleEngineDeps): WiredRuleEngine {
  const lookups = new LiveEvaluationLookups(deps.state);
  const orchestrator = new RuleOrchestrator(
    deps.rules,
    deps.watchlist,
    lookups,
    deps.state,
    deps.notifier,
    deps.eventLog,
    deps.firingState,
  );
  let pending: Promise<void> = Promise.resolve();
  const enqueue = (event: RuleEvent): void => {
    lookups.record(event);
    pending = pending.then(() =>
      orchestrator
        .process(event)
        .catch((err) => handleCascadeError(err, event, deps.eventLog, deps.logger)),
    );
  };
  const candleBridge = new CandleRuleEventBridge(enqueue);
  const indicatorBridge = new IndicatorRuleEventBridge(enqueue);
  const quoteBridge = new QuoteRuleEventBridge(enqueue);
  return {
    candleBridge,
    indicatorBridge,
    quoteBridge,
    lookups,
    async drain(): Promise<void> {
      let last: Promise<void> = pending;
      do {
        last = pending;
        await pending;
      } while (last !== pending);
    },
  };
}
