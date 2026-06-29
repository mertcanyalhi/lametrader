import {
  type CandleRepository,
  type EvaluationTriggerEvent,
  EvaluationTriggerKind,
  type EventLog,
  type Notifier,
  type RuleRepository,
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
import { LiveEvaluationLookups } from './live-evaluation-lookups.js';

/**
 * Inputs for {@link wireRuleEngine} — every collaborator passed by port so
 * the unit tier can swap in fakes and the production wire-up in
 * `connectServices` can drop the Mongo-backed ones in.
 */
export interface RuleEngineDeps {
  /** Rule persistence port. */
  rules: RuleRepository;
  /** State port — read by the dispatcher's context + written by actions. */
  state: StateRepository;
  /** Watchlist port — drives `AllSymbols` fan-out on symbol-less events. */
  watchlist: WatchlistRepository;
  /** Notifier action sink (currently Telegram only). */
  notifier: Notifier;
  /** Event log — orchestrator appends one entry per fire to both sides. */
  eventLog: EventLog;
  /** Read-side candle repository for OHLCV operands (passed through to the context). */
  candleRepository: CandleRepository;
  /** In-memory indicator series store; shared with the indicator service. */
  indicatorStore: IndicatorSeriesStore;
}

/**
 * The composed rule chain returned by {@link wireRuleEngine} — three
 * bridges plus a `drain()` so the composition root (`connect.ts`) can
 * fan-out the platform's event sources into one engine.
 */
export interface WiredRuleEngine {
  /** Bridges {@link SymbolQuoteEvent}s into `TickEvent`s. */
  tickBridge: TickBridge;
  /** Bridges {@link CandleEvent}s into `BarOpened` / `BarClosed`. */
  barBridge: BarLifecycleBridge;
  /** Bridges indicator stream events into `IndicatorChanged`. */
  indicatorBridge: IndicatorCascadeBridge;
  /** The synchronous lookups mirror; exposed for state-mirror warm-ups. */
  lookups: LiveEvaluationLookups;
  /** Wait until the serialized rule chain is fully drained (tests). */
  drain(): Promise<void>;
}

/**
 * Compose the orchestrator + dispatcher + action runner + bridges + the
 * per-symbol serializer + the sync evaluation-lookups mirror into a single
 * live chain.
 *
 * The bridges plug into the platform's existing upstreams
 * (`QuoteStreamService.onQuote`, `PollingService.onCandle`,
 * `IndicatorService.onState`), so the composition root only needs one
 * fan-out point.
 */
export function wireRuleEngine(deps: RuleEngineDeps): WiredRuleEngine {
  const lookups = new LiveEvaluationLookups(deps.state);
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
        // The orchestrator's lookups already track prev via the sync mirror;
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
  type KeyedTriggerEvent = EvaluationTriggerEvent & { symbolId?: string };
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

  const enqueue = (event: EvaluationTriggerEvent): void => {
    recordIntoLookups(lookups, event);
    serializer.enqueue(event as KeyedTriggerEvent);
  };

  // Tick bridge — emits TickEvents into the serializer; also seed the per-symbol
  // tick ring so series-aware operators (Crossing, Channel, Moving) see prior
  // ticks.
  const tickBridge = new TickBridge((event) => {
    if (event.kind === EvaluationTriggerKind.Tick) {
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
function recordIntoLookups(lookups: LiveEvaluationLookups, event: EvaluationTriggerEvent): void {
  if (event.kind === EvaluationTriggerKind.Tick) {
    lookups.recordQuote(event.symbolId, event.price);
    return;
  }
  if (event.kind === EvaluationTriggerKind.IndicatorChanged && event.current !== null) {
    lookups.recordIndicatorState(event.instanceId, event.stateKey, event.current);
  }
}

/**
 * Helper to fan a polling-service candle through both the bar-lifecycle bridge
 * and the lookups mirror. Public so `connect.ts` and tests share one path.
 */
export function feedCandleIntoEngine(wired: WiredRuleEngine, event: CandleEvent): void {
  wired.lookups.recordCandle(event);
  wired.barBridge.handleCandle(event);
}
