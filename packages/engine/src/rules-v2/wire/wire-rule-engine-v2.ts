import type { Notifier, RulesV2, StateRepository, WatchlistRepository } from '@lametrader/core';

import { getLogger } from '../../log.js';
import { BarLifecycleBridge } from '../bridges/bar-lifecycle-bridge.js';
import { IndicatorCascadeBridge } from '../bridges/indicator-cascade-bridge.js';
import { TickBridge } from '../bridges/tick-bridge.js';
import { TriggerDispatcher } from '../dispatch/dispatcher.js';
import { ActionRunner } from '../orchestrator/action-runner.js';
import { RuleOrchestrator } from '../orchestrator/orchestrator.js';
import { createPerSymbolSerializer } from '../orchestrator/per-symbol-serializer.js';
import { LiveEvaluationLookupsV2 } from './live-evaluation-lookups-v2.js';

/** Scope-bound logger for the v2 wire helper's catch-of-last-resort. */
const log = getLogger('rules-v2-wire');

/**
 * Dependencies the {@link wireRuleEngineV2} helper composes into a live v2
 * rule chain.
 */
export interface RuleEngineV2Deps {
  /** v2 rule persistence port (queried on every inbound event). */
  rules: RulesV2.RuleRepository;
  /** Watchlist port (`AllSymbols` fan-out + cascade Symbols-on-symbol-less events). */
  watchlist: WatchlistRepository;
  /** State store the orchestrator writes through. */
  state: StateRepository;
  /** Notification action sink. */
  notifier: Notifier;
  /** v2 event-log port (per-rule + per-symbol mirrored appends). */
  eventLog: RulesV2.EventLog;
}

/**
 * The composed v2 rule chain returned by {@link wireRuleEngineV2}.
 *
 * Callers wire each bridge's `handle*` method into the matching upstream
 * stream service (quote → `tickBridge`, candle polling → `barBridge`,
 * indicator state → `indicatorBridge`).
 */
export interface WiredRuleEngineV2 {
  /** Bridge consuming `SymbolQuoteEvent`s from the quote stream service. */
  tickBridge: TickBridge;
  /** Bridge consuming `CandleEvent`s from the polling loop (bar lifecycle). */
  barBridge: BarLifecycleBridge;
  /** Bridge consuming indicator stream state-change events. */
  indicatorBridge: IndicatorCascadeBridge;
  /** The live v2 evaluation lookups (kept warm by `record` on every enqueue). */
  lookups: LiveEvaluationLookupsV2;
  /**
   * Wait until the serialized v2 rule chain is fully drained.
   *
   * Tests call this after pushing events through to assert end-state; in
   * production it's unused (the chain drains on its own).
   */
  drain(): Promise<void>;
}

/**
 * Compose the v2 orchestrator + three bridges + per-symbol serializer into a
 * single live rule chain — the v2 analogue of {@link wireRuleEngine} per ADR
 * 0016. The two engines run in parallel until cutover.
 */
export function wireRuleEngineV2(deps: RuleEngineV2Deps): WiredRuleEngineV2 {
  const lookups = new LiveEvaluationLookupsV2(deps.state);
  const dispatcher = new TriggerDispatcher();
  const actions = new ActionRunner(deps.state, deps.notifier, lookups);
  const orchestrator = new RuleOrchestrator(
    deps.rules,
    deps.watchlist,
    lookups,
    deps.state,
    deps.eventLog,
    dispatcher,
    actions,
  );
  const serializer = createPerSymbolSerializer(async (event) => {
    try {
      await orchestrator.process(event);
    } catch (err) {
      log.error({ err, event }, 'v2 rule chain crashed');
    }
  });
  const enqueue = (event: RulesV2.EvaluationTriggerEvent): void => {
    lookups.record(event);
    serializer.enqueue(event);
  };
  const tickBridge = new TickBridge(enqueue);
  const barBridge = new BarLifecycleBridge(enqueue);
  const indicatorBridge = new IndicatorCascadeBridge(enqueue);
  return {
    tickBridge,
    barBridge,
    indicatorBridge,
    lookups,
    drain: serializer.drain,
  };
}
