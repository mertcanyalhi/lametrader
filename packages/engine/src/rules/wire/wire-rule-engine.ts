import {
  type CandleRepository,
  type EvaluationTriggerEvent,
  EvaluationTriggerKind,
  type EventLog,
  type GlobalStateChangedEvent,
  type Notifier,
  type RuleEvent,
  type RuleEventEntry,
  RuleEventType,
  type RuleRepository,
  type StateRepository,
  type StateValue,
  type SymbolStateChangedEvent,
  type WatchlistRepository,
} from '@lametrader/core';

import type { CandleEvent } from '../../candles/polling-service.types.js';
import { getLogger } from '../../log.js';
import { BarLifecycleBridge, IndicatorCascadeBridge, TickBridge } from '../bridges/index.js';
import { TriggerDispatcher } from '../dispatch/dispatcher.js';
import { buildEvaluationContext } from '../evaluation-context.js';
import type { IndicatorSeriesStore } from '../indicator-series-store.js';
import { ActionRunner } from '../orchestrator/action-runner.js';
import { RuleOrchestrator } from '../orchestrator/orchestrator.js';
import { createPerSymbolSerializer } from '../orchestrator/per-symbol-serializer.js';
import { TickRing } from '../tick-ring.js';
import { type InitialStateEntry, LiveEvaluationLookups } from './live-evaluation-lookups.js';

/** Scope-bound logger for the v2 rule-engine wire-up. */
const log = getLogger('rules-wire');

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
 *
 * Async because the sync evaluation-lookups mirror is warmed from the
 * persisted {@link StateRepository} before the wired engine is returned —
 * without this, rules reading state slots set by a previous engine process
 * see `null` until that slot is mutated again in this one (#432).
 */
export async function wireRuleEngine(deps: RuleEngineDeps): Promise<WiredRuleEngine> {
  const lookups = new LiveEvaluationLookups(deps.state);
  await warmLookupsFromPersistedState(lookups, deps);
  const tickRings = new Map<string, TickRing>();
  const actions = new ActionRunner(deps.state, deps.notifier, lookups);
  const dispatcher = new TriggerDispatcher({
    rules: deps.rules,
    buildContext: (event, firingSymbolId, profileId) => {
      // Cascade events (`SymbolStateChanged` / `GlobalStateChanged`) already
      // carry the slot's `prev` value on their payload — thread it through so
      // `ChangesTo` / `ChangesFrom` see the real prior value instead of `null`
      // (#433).
      // The non-cascade paths (tick / bar / timer / indicator) still resolve
      // prev to `null` for state slots — sourcing a meaningful prev there is
      // larger scope and explicitly deferred by #433.
      const cascadePrev = cascadePrevLookups(event);
      // Lazy: bar window is "everything stored so far" — operators that need
      // a real lookback window pull from the indicator store + tick ring,
      // which already encode their own bounds. Upgrade path: derive the
      // window from the firing rule's `lookbackBars` × interval.
      return buildEvaluationContext({
        symbolId: firingSymbolId,
        profileId,
        candleRepository: deps.candleRepository,
        tickRings,
        indicatorStore: deps.indicatorStore,
        barWindow: { from: 0, to: Number.MAX_SAFE_INTEGER },
        getSymbolState: (pid, symbolId, key) => lookups.getSymbolState(pid, symbolId, key),
        getGlobalState: (pid, key) => lookups.getGlobalState(pid, key),
        getPrevSymbolState: cascadePrev.getPrevSymbolState,
        getPrevGlobalState: cascadePrev.getPrevGlobalState,
        getPrevIndicator: () => null,
        barSeries: lookups.bookSeriesFor(firingSymbolId),
      });
    },
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
    } catch (error) {
      // Keep the per-symbol chain alive; the orchestrator already handles
      // CycleOverflow by recording an event and returning — bubbling here
      // means an unexpected programmer error (corrupt rule, repository
      // timeout, etc.). Surface it through both the engine log and the
      // event log so operators can see why a fire was dropped instead of
      // observing silent inaction (#431).
      await recordOrchestratorFailure(deps.eventLog, event, error);
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
 * The pair of one-step-back state lookups
 * {@link buildEvaluationContext} consumes for `SymbolStateRef` /
 * `GlobalStateRef` operands.
 *
 * Returned by {@link cascadePrevLookups} so the wire-up can hand the right
 * `prev` value to `ChangesTo` / `ChangesFrom` on the cascade path (#433).
 */
export interface CascadePrevLookups {
  /** Per-slot prev lookup for {@link OperandKind.SymbolStateRef}. */
  getPrevSymbolState(profileId: string, symbolId: string, key: string): StateValue | null;
  /** Per-slot prev lookup for {@link OperandKind.GlobalStateRef}. */
  getPrevGlobalState(profileId: string, key: string): StateValue | null;
}

/**
 * Build the `(getPrevSymbolState, getPrevGlobalState)` pair the
 * dispatcher's `buildContext` hands to {@link buildEvaluationContext}.
 *
 * On a `SymbolStateChanged` event the symbol-state lookup returns
 * `event.prev` for the matching `(profileId, symbolId, key)` triple and
 * `null` for every other slot.
 * On a `GlobalStateChanged` event the global-state lookup returns
 * `event.prev` for the matching `(profileId, key)` pair and `null`
 * elsewhere.
 * On any other event kind (tick / bar / timer / indicator) both lookups
 * return `null` — sourcing prev for state slots on the non-cascade paths
 * is larger scope and explicitly deferred by #433.
 *
 * Pure — derives its return value entirely from the inbound event's
 * payload. The dispatcher invokes `buildContext` once per fan-out target,
 * so a fresh lookups pair lands per `(event, firingSymbolId, profileId)`
 * triple with no shared mutable state.
 */
export function cascadePrevLookups(event: RuleEvent): CascadePrevLookups {
  if (event.kind === EvaluationTriggerKind.SymbolStateChanged) {
    return symbolCascadePrev(event);
  }
  if (event.kind === EvaluationTriggerKind.GlobalStateChanged) {
    return globalCascadePrev(event);
  }
  return NULL_PREV_LOOKUPS;
}

/**
 * Cascade-driven prev lookups for a {@link SymbolStateChangedEvent}.
 *
 * Returns `event.prev` only when the operand's
 * `(profileId, symbolId, key)` triple matches the event's slot; every other
 * slot reads `null` so unrelated `ChangesTo` / `ChangesFrom` evaluations
 * stay correctly inert.
 */
function symbolCascadePrev(event: SymbolStateChangedEvent): CascadePrevLookups {
  return {
    getPrevSymbolState(profileId, symbolId, key) {
      if (profileId !== event.profileId) return null;
      if (symbolId !== event.symbolId) return null;
      if (key !== event.key) return null;
      return event.prev;
    },
    getPrevGlobalState: () => null,
  };
}

/**
 * Cascade-driven prev lookups for a {@link GlobalStateChangedEvent}.
 *
 * Returns `event.prev` only when the operand's `(profileId, key)` pair
 * matches the event's slot; every other slot reads `null`.
 */
function globalCascadePrev(event: GlobalStateChangedEvent): CascadePrevLookups {
  return {
    getPrevSymbolState: () => null,
    getPrevGlobalState(profileId, key) {
      if (profileId !== event.profileId) return null;
      if (key !== event.key) return null;
      return event.prev;
    },
  };
}

/**
 * Default lookups pair — both readers always return `null`.
 *
 * Used on the non-cascade paths (tick / bar / timer / indicator) so the
 * dispatcher's `buildContext` always receives a stable shape. Same single
 * instance for every event since neither reader closes over state.
 */
const NULL_PREV_LOOKUPS: CascadePrevLookups = {
  getPrevSymbolState: () => null,
  getPrevGlobalState: () => null,
};

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

/**
 * Log an orchestrator-level failure and append an `Error` rule-event entry to
 * the affected symbol's event log (and the global chain when the event has no
 * symbol).
 *
 * The orchestrator handles cycle overflows itself; everything that reaches
 * this handler is unexpected (e.g. a repository timeout, a corrupt rule).
 *
 * Lazy: the entry uses an empty `ruleId` because the dispatcher's per-rule
 * fan-out hadn't returned by the time the throw escaped — same convention as
 * `CycleOverflow`. Upgrade path: when the orchestrator can surface the
 * partially-resolved rule via the error itself, pipe its id into the entry.
 */
async function recordOrchestratorFailure(
  eventLog: EventLog,
  event: EvaluationTriggerEvent,
  error: unknown,
): Promise<void> {
  const symbolId = symbolIdOf(event) ?? '';
  const reason = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  log.error(
    { err: { message: reason, stack }, eventKind: event.kind, eventTs: event.ts, symbolId },
    'orchestrator_process_failed',
  );
  const entry: RuleEventEntry = {
    type: RuleEventType.Error,
    ts: event.ts,
    ruleId: '',
    symbolId,
    reason: `orchestrator process failed: ${reason}`,
  };
  try {
    await eventLog.appendSymbolEvent(symbolId, entry);
  } catch (logError) {
    // The event log itself failed — there's nowhere safe left to surface
    // this beyond the engine log; do not re-throw or the serializer's
    // per-symbol chain dies on the next event too.
    log.error(
      { err: { message: logError instanceof Error ? logError.message : String(logError) } },
      'orchestrator_failure_log_failed',
    );
  }
}

/**
 * Build the warm snapshot from the persisted {@link StateRepository} and
 * hand it to {@link LiveEvaluationLookups.warmInitialState} so the sync
 * mirror is non-empty before the orchestrator processes its first event.
 *
 * Enumeration sources the set of profile ids from `rules.list()` (every
 * persisted rule names its profile) and the set of symbols from
 * `watchlist.list()` (the only symbols the engine ever evaluates against).
 * For each `(profileId, symbolId)` pair we read the persisted per-symbol
 * state; for each profile we read the persisted global state.
 *
 * Lazy: this is `O(profiles × watchedSymbols)` repo reads at startup, which
 * matches real workloads (handful of profiles × tens of symbols). Upgrade
 * path: add a single `listAll*` repo method when that loop dominates startup
 * — at which point this helper collapses to two calls and the
 * `(profileId, symbolId)` enumeration drops out of the engine entirely.
 */
async function warmLookupsFromPersistedState(
  lookups: LiveEvaluationLookups,
  deps: RuleEngineDeps,
): Promise<void> {
  const rules = await deps.rules.list();
  const profileIds = [...new Set(rules.map((rule) => rule.profileId))];
  if (profileIds.length === 0) return;

  const watched = await deps.watchlist.list();
  const symbolIds = watched.map((symbol) => symbol.id);
  const snapshot: InitialStateEntry[] = [];

  for (const profileId of profileIds) {
    const globalEntries = await deps.state.listGlobalState(profileId);
    for (const [key, value] of Object.entries(globalEntries)) {
      snapshot.push({ scope: 'global', profileId, key, value });
    }
    for (const symbolId of symbolIds) {
      const symbolEntries = await deps.state.listSymbolState(profileId, symbolId);
      for (const [key, value] of Object.entries(symbolEntries)) {
        snapshot.push({ scope: 'symbol', profileId, symbolId, key, value });
      }
    }
  }

  lookups.warmInitialState(snapshot);
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
