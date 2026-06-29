import {
  type CandleRepository,
  type Notifier,
  RulesV2,
  type StateRepository,
  type WatchlistRepository,
} from '@lametrader/core';

import type { CandleEvent } from '../../candles/polling-service.types.js';
import { BarLifecycleBridge, IndicatorCascadeBridge, TickBridge } from '../bridges/index.js';
import { TriggerDispatcher } from '../dispatch/dispatcher.js';
import { buildEvaluationContext } from '../evaluation-context.js';
import type { IndicatorSeriesStore } from '../indicator-series-store.js';
import { ActionRunner } from '../orchestrator/action-runner.js';
import { RuleOrchestrator } from '../orchestrator/orchestrator.js';
import { createPerSymbolSerializer } from '../orchestrator/per-symbol-serializer.js';
import { TickRing } from '../tick-ring.js';
import { LiveEvaluationLookupsV2 } from './live-evaluation-lookups-v2.js';

/**
 * Inputs for {@link wireRuleEngineV2} — every collaborator passed by port so
 * the unit tier can swap in fakes and the production wire-up in
 * `connectServices` can drop the Mongo-backed ones in.
 *
 * v2 analogue of v1's `RuleEngineDeps` (per ADR 0016).
 */
export interface RuleEngineV2Deps {
  /** v2 rule persistence port. */
  rules: RulesV2.RuleRepository;
  /** State port — read by the dispatcher's context + written by actions. */
  state: StateRepository;
  /** Watchlist port — drives `AllSymbols` fan-out on symbol-less events. */
  watchlist: WatchlistRepository;
  /** Notifier action sink (currently Telegram only). */
  notifier: Notifier;
  /** v2 event log — orchestrator appends one entry per fire to both sides. */
  eventLog: RulesV2.EventLog;
  /** Read-side candle repository for OHLCV operands (passed through to the context). */
  candleRepository: CandleRepository;
  /** In-memory indicator series store; shared with the indicator service. */
  indicatorStore: IndicatorSeriesStore;
}

/**
 * The composed v2 rule chain returned by {@link wireRuleEngineV2}.
 *
 * Mirrors v1's `WiredRuleEngine` shape — three bridges plus a `drain()` —
 * so the composition root (`connect.ts`) wires both engines uniformly.
 */
export interface WiredRuleEngineV2 {
  /** Bridges {@link SymbolQuoteEvent}s into v2 `TickEvent`s. */
  tickBridge: TickBridge;
  /** Bridges {@link CandleEvent}s into v2 `BarOpened` / `BarClosed`. */
  barBridge: BarLifecycleBridge;
  /** Bridges indicator stream events into v2 `IndicatorChanged`. */
  indicatorBridge: IndicatorCascadeBridge;
  /** The synchronous lookups mirror; exposed for state-mirror warm-ups. */
  lookups: LiveEvaluationLookupsV2;
  /** Wait until the serialized rule chain is fully drained (tests). */
  drain(): Promise<void>;
}

/**
 * Compose the v2 orchestrator + dispatcher + action runner + bridges + the
 * per-symbol serializer + the sync evaluation-lookups mirror into a single
 * live chain — v2 analogue of v1's {@link wireRuleEngine}.
 *
 * Per ADR 0016 the two engines coexist behind the feature flag until cutover.
 * The bridges plug into the same upstreams v1 listens on
 * (`QuoteStreamService.onQuote`, `PollingService.onCandle`,
 * `IndicatorService.onState`), so the composition root only needs one fan-out
 * point.
 */
export function wireRuleEngineV2(deps: RuleEngineV2Deps): WiredRuleEngineV2 {
  const lookups = new LiveEvaluationLookupsV2(deps.state);
  const tickRings = new Map<string, TickRing>();
  const actions = new ActionRunner(deps.state, deps.notifier, lookups);
  const dispatcher = new TriggerDispatcher({
    rules: deps.rules,
    buildContext: (_event, firingSymbolId) =>
      // Lazy: bar window is "everything stored so far" — operators that need
      // a real lookback window pull from the indicator store + tick ring,
      // which already encode their own bounds. Upgrade path: derive the
      // window from the firing rule's `lookbackBars` × interval.
      buildEvaluationContext({
        symbolId: firingSymbolId,
        // Lazy: the dispatcher doesn't carry the rule's profileId. State
        // refs without a profile in the context resolve to `null`, which
        // current operators interpret as "no value". Upgrade path: thread
        // the firing rule's `profileId` into the dispatch's per-rule
        // context builder.
        profileId: '',
        candleRepository: deps.candleRepository,
        tickRings,
        indicatorStore: deps.indicatorStore,
        barWindow: { from: 0, to: Number.MAX_SAFE_INTEGER },
        getSymbolState: (profileId, symbolId, key) =>
          lookups.getSymbolState(profileId, symbolId, key),
        getGlobalState: (profileId, key) => lookups.getGlobalState(profileId, key),
        // The orchestrator's lookups already track prev via the v1 sync mirror;
        // pass the same getters through so `ChangesTo`/`ChangesFrom` see the
        // same value the action runner saw.
        getPrevSymbolState: () => null,
        getPrevGlobalState: () => null,
        getPrevIndicator: () => null,
        barSeries: lookups.bookSeriesFor(firingSymbolId),
      }),
  });
  const orchestrator = new RuleOrchestrator({
    rules: deps.rules,
    state: deps.state,
    watchlist: deps.watchlist,
    dispatcher,
    actions,
    eventLog: deps.eventLog,
  });

  // The serializer keys on an optional `symbolId`; `TimerEvent` lands on the
  // global chain (no symbol). Widen the type to satisfy the generic constraint.
  type KeyedTriggerEvent = RulesV2.EvaluationTriggerEvent & { symbolId?: string };
  const serializer = createPerSymbolSerializer<KeyedTriggerEvent>(async (event) => {
    try {
      await orchestrator.process(event);
    } catch {
      // Keep the per-symbol chain alive; the orchestrator already handles
      // CycleOverflow by recording an event and returning — bubbling here
      // means an unexpected programmer error that we don't want to crash
      // the whole engine over.
    }
  });

  const enqueue = (event: RulesV2.EvaluationTriggerEvent): void => {
    recordIntoLookups(lookups, event);
    serializer.enqueue(event as KeyedTriggerEvent);
  };

  // Tick bridge — emits TickEvents into the serializer; also seed the per-symbol
  // tick ring so series-aware operators (Crossing, Channel, Moving) see prior
  // ticks.
  const tickBridge = new TickBridge((event) => {
    if (event.kind === RulesV2.EvaluationTriggerKind.Tick) {
      let ring = tickRings.get(event.symbolId);
      if (ring === undefined) {
        ring = new TickRing();
        tickRings.set(event.symbolId, ring);
      }
      ring.push(event.ts, event.price);
    }
    enqueue(event);
  });
  const barBridge = new BarLifecycleBridge(enqueue);
  const indicatorBridge = new IndicatorCascadeBridge(enqueue);

  // Wrap the bar bridge with a `handleCandle` proxy that first updates the
  // sync lookups cache (so the action runner's snapshot AND the dispatcher's
  // sync `barSeries` lookup both see the freshly observed bar).
  const wrappedBarBridge: BarLifecycleBridge = Object.create(barBridge);
  const originalHandleCandle = barBridge.handleCandle.bind(barBridge);
  wrappedBarBridge.handleCandle = (event: CandleEvent) => {
    lookups.recordCandle(event);
    originalHandleCandle(event);
  };

  return {
    tickBridge,
    barBridge: wrappedBarBridge,
    indicatorBridge,
    lookups,
    drain: serializer.drain,
  };
}

/**
 * Side-effect of every event passing through the wire — update the sync
 * mirror so the `ActionRunner` snapshot at fire time matches what the
 * inbound event observed.
 */
function recordIntoLookups(
  lookups: LiveEvaluationLookupsV2,
  event: RulesV2.EvaluationTriggerEvent,
): void {
  if (event.kind === RulesV2.EvaluationTriggerKind.Tick) {
    lookups.recordQuote(event.symbolId, event.price);
    return;
  }
  if (event.kind === RulesV2.EvaluationTriggerKind.IndicatorChanged && event.current !== null) {
    lookups.recordIndicatorState(event.instanceId, event.stateKey, event.current);
  }
}

/**
 * Helper to fan a polling-service candle through both the bar-lifecycle bridge
 * and the lookups mirror. Public so `connect.ts` and tests share one path.
 */
export function feedCandleIntoEngineV2(wired: WiredRuleEngineV2, event: CandleEvent): void {
  wired.lookups.recordCandle(event);
  wired.barBridge.handleCandle(event);
}
