import type { CandleEvent } from '@lametrader/core';
import {
  type CandleRepository,
  type EvaluationTriggerEvent,
  EvaluationTriggerKind,
  type EventLog,
  type GlobalStateChangedEvent,
  type IndicatorStateEvent,
  type Notifier,
  type RuleEvent,
  type RuleEventEntry,
  RuleEventType,
  type RuleRepository,
  type StateRepository,
  type StateValue,
  type SymbolStateChangedEvent,
  type TickEvent,
  type WatchlistRepository,
} from '@lametrader/core';
import { type BarAxis, FallbackSeriesView } from '../bar-series-view.js';
import { BarLifecycleBridge, IndicatorCascadeBridge } from '../bridges/index.js';
import { TriggerDispatcher } from '../dispatch/dispatcher.js';
import { getLogger } from '../engine-log.js';
import { buildBarSeriesPagers, buildEvaluationContext } from '../evaluation-context.js';
import type { IndicatorSeriesStore } from '../indicator-series-store.js';
import { ActionRunner } from '../orchestrator/action-runner.js';
import { RuleOrchestrator } from '../orchestrator/orchestrator.js';
import { createPerSymbolSerializer } from '../orchestrator/per-symbol-serializer.js';
import type { SeriesView } from '../series.types.js';
import { type InitialStateEntry, LiveEvaluationLookups } from './live-evaluation-lookups.js';

/**
 * Scope-bound logger for the rule-engine wire-up.
 *
 * Sits under `engine.rules.wire` so a single `engine.rules.*:trace` setting
 * enables every rules-engine surface together (per #436).
 */
const log = getLogger('engine.rules.wire');

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
  /**
   * Bridges {@link CandleEvent}s into `BarOpened` / `BarClosed` plus a `Tick`
   * carrying the candle's close — the platform ingests candles, not trades,
   * so each poll is the tick that drives per-tick triggers.
   */
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
  const actions = new ActionRunner(deps.state, deps.notifier, lookups);
  const dispatcher = new TriggerDispatcher({
    rules: deps.rules,
    buildContext: async (event, firingSymbolId, profileId) => {
      // Cascade events (`SymbolStateChanged` / `GlobalStateChanged`) already
      // carry the slot's `prev` value on their payload — thread it through so
      // `ChangesTo` / `ChangesFrom` see the real prior value instead of `null`
      // (#433).
      // The non-cascade paths (tick / bar / timer / indicator) still resolve
      // prev to `null` for state slots — sourcing a meaningful prev there is
      // larger scope and explicitly deferred by #433.
      const cascadePrev = cascadePrevLookups(event);
      // Build a lazy, repository-backed multi-bar OHLCV series (not the
      // single-point live mirror) so series operators — `Moving` / `Channel`
      // / `Crossing` — walk the actual history behind the store, paging on
      // demand (#499). Nothing is loaded here: each pager fetches its first
      // page only when an operator reads that operand. The window is
      // "everything stored up to and including the bar under evaluation" per
      // observed `(period, axis)`: the upper bound is the firing event's
      // timestamp so a candle stored *after* this observation (a later bar the
      // repository already holds, or leftover cross-run data) never leaks in as
      // the series' newest point — which would make a series operator read the
      // wrong "current" bar and never fire.
      // Upgrade path: also bound `from` to each firing rule's `lookbackBars`
      // × interval once the dispatcher threads the rule through.
      const barSeries = buildLiveBarSeries(
        deps.candleRepository,
        firingSymbolId,
        event.ts,
        lookups,
      );
      return buildEvaluationContext({
        symbolId: firingSymbolId,
        profileId,
        candleRepository: deps.candleRepository,
        indicatorStore: deps.indicatorStore,
        // Bound the lazy `IndicatorRef` view to `time < event.ts + 1` — the same
        // exclusive upper bound the bar pagers bake in (`upperTs + 1`), so a
        // candle stored after this observation can't become the indicator's
        // newest point (mirrors #504's bar-series bound).
        before: event.ts + 1,
        getSymbolState: (pid, symbolId, key) => lookups.getSymbolState(pid, symbolId, key),
        getGlobalState: (pid, key) => lookups.getGlobalState(pid, key),
        getPrevSymbolState: cascadePrev.getPrevSymbolState,
        getPrevGlobalState: cascadePrev.getPrevGlobalState,
        getPrevIndicator: () => null,
        barSeries,
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

  // The serializer processes one {@link EventBatch} at a time per symbol; each
  // batch advances the sync lookups mirror *inside* its serialized step (via
  // `record`) immediately before processing that batch's events — so every
  // event evaluates against the mirror state of its own upstream observation,
  // never a later batch's (#459). `TimerEvent`-only batches land on the global
  // chain (no symbol).
  const serializer = createPerSymbolSerializer<EventBatch>(async (batch) => {
    batch.record();
    for (const event of batch.events) {
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
    }
  });

  // Bar bridge — collect the lifecycle events one candle fans out (synchronous
  // per the bridge contract), then enqueue them as one batch whose `record`
  // updates the OHLCV + price mirror for that candle. The five OHLCV axes land
  // together (one atomic observation) before any of the candle's events.
  //
  // The platform ingests candles, not trades, so each poll IS the tick: a
  // `Tick` carrying the forming bar's close rides in the same batch, after the
  // candle's bar-lifecycle events, so per-tick triggers (Once / EveryTime /
  // OncePerBar) evaluate on every poll and a `BarOpened` clears its OncePerBar
  // latch before the tick that may re-fire it.
  const barBatch: EvaluationTriggerEvent[] = [];
  const barBridge = new BarLifecycleBridge((event) => barBatch.push(event));
  const rawHandleCandle = barBridge.handleCandle.bind(barBridge);
  const wrappedBarBridge: BarLifecycleBridge = Object.create(barBridge);
  wrappedBarBridge.handleCandle = (candle: CandleEvent): void => {
    barBatch.length = 0;
    rawHandleCandle(candle);
    const tick: TickEvent = {
      kind: EvaluationTriggerKind.Tick,
      ts: candle.candle.time,
      symbolId: candle.id,
      price: candle.candle.close,
    };
    serializer.enqueue({
      symbolId: candle.id,
      record: () => {
        lookups.recordCandle(candle);
      },
      events: [...barBatch, tick],
    });
  };

  // Indicator bridge — collect the per-state-key IndicatorChanged events one
  // upstream row fans out, then enqueue them as one batch whose `record`
  // mirrors the row's changed values. One row = one atomic observation.
  const indicatorBatch: EvaluationTriggerEvent[] = [];
  const indicatorBridge = new IndicatorCascadeBridge((event) => indicatorBatch.push(event));
  const rawHandleIndicatorState = indicatorBridge.handleIndicatorState.bind(indicatorBridge);
  const wrappedIndicatorBridge: IndicatorCascadeBridge = Object.create(indicatorBridge);
  wrappedIndicatorBridge.handleIndicatorState = (event: IndicatorStateEvent): void => {
    indicatorBatch.length = 0;
    rawHandleIndicatorState(event);
    if (indicatorBatch.length === 0) return;
    const events = indicatorBatch.slice();
    serializer.enqueue({
      symbolId: event.id,
      record: () => {
        for (const e of events) {
          if (e.kind === EvaluationTriggerKind.IndicatorChanged && e.current !== null) {
            lookups.recordIndicatorState(e.instanceId, e.stateKey, e.current);
          }
        }
      },
      events,
    });
  };

  return {
    barBridge: wrappedBarBridge,
    indicatorBridge: wrappedIndicatorBridge,
    lookups,
    drain: serializer.drain,
  };
}

/**
 * One unit of serialized work for the per-symbol serializer.
 *
 * A batch is one upstream observation (a candle, a quote, or an indicator
 * state row) fanned out into its trigger events. Its {@link record} advances
 * the sync {@link LiveEvaluationLookups} mirror and runs *inside* the
 * serialized step, immediately before {@link events} are processed — so each
 * event evaluates against the mirror state of its own observation and never a
 * later batch's (#459).
 */
interface EventBatch {
  /** Serializer key — every event in the batch shares this symbol (absent = global chain). */
  symbolId?: string;
  /** Advance the sync lookups mirror for this observation. */
  record(): void;
  /** The trigger events to process in order, after {@link record}. */
  events: readonly EvaluationTriggerEvent[];
}

/**
 * The five OHLCV axes projected for each observed period when building the
 * live bar series — the same axis set the single-point mirror booked, now
 * backed by the candle repository's real history.
 */
const BAR_AXES: readonly BarAxis[] = ['open', 'high', 'low', 'close', 'volume'];

/**
 * Build the `(period, axis) → SeriesView` map the evaluation context reads for
 * OHLCV / `Price` operands, backed by the real candle history — lazily.
 *
 * For every period the symbol has an observed candle on (per the live mirror),
 * wires a {@link PagedBarSeriesView} pager over the candle repository for each of
 * the five OHLCV axes via {@link buildBarSeriesPagers}. Series operators (`Moving` /
 * `Channel` / `Crossing`) then walk the actual stored bars — paging backward on
 * demand — instead of the single live-mirror point that made them never fire
 * (#499). Nothing is loaded up front: a pager fetches its first page only when
 * an operator reads that operand.
 *
 * Each pager is wrapped in a {@link FallbackSeriesView} over the single-point
 * live mirror ({@link LiveEvaluationLookups.bookSeriesFor}): when the repository
 * holds history for a `(period, axis)` the pager wins; when it holds none yet
 * (e.g. the forming bar under evaluation, before the poll loop persists it) the
 * mirror's snapshot point stands in, so snapshot / comparison operands that read
 * the latest value keep resolving. This preserves the earlier eager "override
 * the mirror only where the repository has rows" merge without an up-front probe.
 * Returns just the mirror map for an unobserved symbol.
 *
 * `upperTs` is the firing observation's timestamp: every pager is bounded to
 * `time < upperTs + 1` so a repository row stored *after* this observation — a
 * later bar the store already holds, or leftover data from another run against a
 * shared store — never becomes the series' newest point and is never mistaken
 * for the current bar (#504).
 */
function buildLiveBarSeries(
  candleRepository: CandleRepository,
  symbolId: string,
  upperTs: number,
  lookups: LiveEvaluationLookups,
): ReadonlyMap<string, SeriesView> {
  const mirror = lookups.bookSeriesFor(symbolId);
  const merged = new Map<string, SeriesView>(mirror);
  const required = lookups
    .observedPeriods(symbolId)
    .flatMap((period) => BAR_AXES.map((axis) => ({ period, axis })));
  const pagers = buildBarSeriesPagers(candleRepository, symbolId, upperTs + 1, required);
  for (const [key, pager] of pagers) {
    const fallback = mirror.get(key);
    merged.set(key, fallback ? new FallbackSeriesView(pager, fallback) : pager);
  }
  return merged;
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
 * Helper to fan a polling-service candle through the bar-lifecycle bridge.
 * Public so `connect.ts` and tests share one path.
 *
 * The OHLCV mirror is advanced *inside* the serialized step the bridge enqueues
 * (not synchronously here), so the mirror stays consistent with the candle
 * event under evaluation (#459).
 */
export function feedCandleIntoEngine(wired: WiredRuleEngine, event: CandleEvent): void {
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
