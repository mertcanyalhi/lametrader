import {
  type BacktestOpenPosition,
  type BacktestParams,
  type BacktestProgress,
  type BacktestStrategy,
  type BacktestSummary,
  type BacktestTrade,
  type Candle,
  type CandleRepository,
  type Notifier,
  type Period,
  type Profile,
  periodMillis,
  type RuleEventEntry,
  type RuleRepository,
  type WatchlistRepository,
} from '@lametrader/core';
import { InMemoryEventLog } from '../../common/persistence/in-memory-event-log.js';
import { InMemoryWatchlistRepository } from '../../market/persistence/in-memory-watchlist.repository.js';
import { IndicatorService } from '../indicators/indicator.service.js';
import type { IndicatorRegistry } from '../indicators/indicator-registry.js';
import { InMemoryProfileRepository } from '../persistence/in-memory-profile.repository.js';
import { InMemoryStateRepository } from '../persistence/in-memory-state.repository.js';
import { InMemoryOncePerBarLatchStore } from '../rules/dispatch/in-memory-once-per-bar-latch.store.js';
import { InMemoryRuleRepository } from '../rules/in-memory-rule.repository.js';
import { IndicatorSeriesStore } from '../rules/indicator-series-store.js';
import { registerIndicatorInstances } from '../rules/wire/register-indicator-instances.js';
import { feedCandleIntoEngine, wireRuleEngine } from '../rules/wire/wire-rule-engine.js';
import { BacktestExecutor, emptyBacktestSummary } from './backtest-executor.js';
import { derivePreloadBars } from './derive-preload-bars.js';
import { preloadCandleRepository } from './preloaded-candle.repository.js';

/**
 * Builds the run-local {@link IndicatorService} a replay computes indicators
 * through — over the preloaded candle window, not the shared store.
 *
 * Injected so a test can substitute a recording service that observes each
 * `compute`; production uses {@link defaultIndicatorServiceFactory}.
 */
export type IndicatorServiceFactory = (
  registry: IndicatorRegistry,
  watchlist: WatchlistRepository,
  candles: CandleRepository,
) => IndicatorService;

/** The production factory: a plain {@link IndicatorService} with a no-op state sink (a backtest streams no indicator state). */
const defaultIndicatorServiceFactory: IndicatorServiceFactory = (registry, watchlist, candles) =>
  new IndicatorService(registry, watchlist, candles, { onState: () => {} });

/** Milliseconds in a calendar day — the unit progress is reported in. */
const DAY_MS = 86_400_000;

/**
 * Hand the event loop back every this many replayed candles.
 *
 * The replay reads entirely from the preloaded in-memory window, so its
 * per-candle `await`s resolve on the microtask queue and never yield to the
 * event loop's I/O phase — the whole run would otherwise block the loop
 * end-to-end, so a concurrent `GET /backtests/:id` progress poll could not be
 * serviced until the run finished (progress would jump 0 → 100). A periodic
 * `setImmediate` yield lets the poll observe intermediate progress.
 */
const YIELD_EVERY_CANDLES = 200;

/**
 * One stored candle tagged with the period it was sampled at, ready to be
 * ordered into the replay feed.
 */
export interface FeedCandle {
  /** The period the candle was sampled at. */
  period: Period;
  /** The candle itself. */
  candle: Candle;
}

/**
 * Hooks the {@link BacktestReplayService} calls back into during a replay so the
 * job layer can track progress and cancel mid-run without the replay knowing
 * about the job at all.
 */
export interface BacktestReplayHooks {
  /** Reports replay progress after each fed candle (and once at the ends). */
  onProgress?: (progress: BacktestProgress) => void;
  /** Polled before each candle; when it returns `true` the replay stops early. */
  isCancelled?: () => boolean;
}

/**
 * The outcome of a completed replay — the run events its isolated engine
 * recorded, the trading model's closed trades / open position / summary over
 * them, plus whether the run was cancelled before it finished.
 */
export interface BacktestReplayResult {
  /** The run events, in engine emission (append) order. */
  events: RuleEventEntry[];
  /** The closed round trips the trading model produced, in exit order. */
  trades: BacktestTrade[];
  /** The position still open when the replay ended, if any. */
  openPosition?: BacktestOpenPosition;
  /** Aggregate metrics over the closed trades. */
  summary: BacktestSummary;
  /** `true` when {@link BacktestReplayHooks.isCancelled} stopped the replay early. */
  cancelled: boolean;
}

/**
 * The port the {@link BacktestService} drives to replay a run — one `replay`
 * call.
 *
 * Extracted so the run service depends on the behaviour, not the concrete
 * engine: the unit tier substitutes a controllable fake (canned events,
 * hang-forever, cancellation) without wiring a real engine, while production
 * binds {@link BacktestReplayService}.
 */
export interface BacktestReplayPort {
  /**
   * Replay `params`' window through a throwaway engine seeded with `profile`'s
   * rules over its active `periods`, running `strategy`'s trading model over the
   * candles + events, reporting progress + honouring cancellation through
   * `hooks`.
   */
  replay(
    params: BacktestParams,
    strategy: BacktestStrategy,
    profile: Profile,
    periods: Period[],
    hooks?: BacktestReplayHooks,
  ): Promise<BacktestReplayResult>;
}

/**
 * A {@link Notifier} that records nothing to any real channel — the run's
 * notification sink.
 *
 * The action runner still records a `NotificationSent` event on a successful
 * `send`, so a run's notification-driven events land in its own event log while
 * nothing is actually delivered (spec: *Run semantics → Isolation*).
 */
class RecordingNoOpNotifier implements Notifier {
  /** Every `(destinationName, body)` a run "sent" — recorded, never delivered. */
  readonly sent: Array<{ destinationName: string; body: string }> = [];

  async send(destinationName: string, body: string): Promise<void> {
    this.sent.push({ destinationName, body });
  }
}

/**
 * Replays a symbol's stored candle history through a **throwaway** rule engine
 * instance and returns the events the run produced — the isolated engine beneath
 * the {@link Backtest} resource.
 *
 * Each replay wires its own in-memory state repository, event log, indicator
 * series store, and once-per-bar latch, seeds a rule repository with only the
 * selected profile's rules, and swaps the notifier for a no-op recorder. The
 * live state store, live event log, live latch, and the real notifier are never
 * touched: a backtest writes no live state, sends no notification, and leaves
 * the live rule engine alone.
 *
 * Before the replay the run **preloads** a bounded candle window per active
 * period — `[start − maxLookback × periodMillis, end)` — into an in-memory
 * {@link import('./preloaded-candle.repository.js').PreloadedCandleRepository}
 * and reads every candle from it (a run-local {@link IndicatorService} over the
 * same window, the bar-series pagers, and the indicator-series pagers all share
 * it), so a drain issues no candle-store round-trips. A lookback reaching below
 * the preloaded floor falls through to the shared store, keeping the unbounded
 * `Crossing` / `Channel` operators correct regardless of the preload size
 * (ADR-0022).
 */
export class BacktestReplayService implements BacktestReplayPort {
  /**
   * @param candles - the shared candle store the window is preloaded from (and falls back to).
   * @param rules - the shared rule store; the run seeds a fresh engine with the profile's rules.
   * @param watchlist - the shared watchlist; the run resolves its one symbol and wraps it in memory.
   * @param registry - the indicator registry the run-local indicator service and the analyzer read.
   * @param makeIndicatorService - factory for the run-local indicator service (injected for tests).
   */
  constructor(
    private readonly candles: CandleRepository,
    private readonly rules: RuleRepository,
    private readonly watchlist: WatchlistRepository,
    private readonly registry: IndicatorRegistry,
    private readonly makeIndicatorService: IndicatorServiceFactory = defaultIndicatorServiceFactory,
  ) {}

  /**
   * Load a symbol's stored candles across all active periods in `[start, end)`,
   * order them by completion time (ties finest-period-first), and feed each as a
   * final `CandleEvent` through a throwaway engine seeded with the profile's
   * rules.
   *
   * Progress is reported as elapsed replay days over the total days of
   * `[start, end]` after each fed candle. When {@link BacktestReplayHooks.isCancelled}
   * returns `true` the replay stops and returns `cancelled: true` with no events.
   *
   * @param params - the run parameters (symbol, window, period, capital, commission).
   * @param strategy - the strategy snapshot whose trading model runs over the feed.
   * @param profile - the profile whose rules drive the run (enabled, in scope).
   * @param periods - the symbol's active periods to replay.
   * @param hooks - progress + cancellation callbacks.
   */
  async replay(
    params: BacktestParams,
    strategy: BacktestStrategy,
    profile: Profile,
    periods: Period[],
    hooks: BacktestReplayHooks = {},
  ): Promise<BacktestReplayResult> {
    const totalDays = (params.end - params.start) / DAY_MS;
    hooks.onProgress?.({ elapsedDays: 0, totalDays });

    const rulesForProfile = (await this.rules.list()).filter(
      (rule) => rule.profileId === profile.id,
    );
    // Preload `[start − maxLookback, end)` per period into memory; every candle
    // read the drain issues is served from it, with a read-through fallback to
    // the shared store below the floor (ADR-0022).
    const bars = derivePreloadBars(rulesForProfile, profile.indicators, this.registry);
    const candles = await preloadCandleRepository(
      this.candles,
      params.symbolId,
      periods,
      bars,
      params.start,
      params.end,
    );
    const feed = orderBacktestFeed(await this.loadFeed(candles, params, periods));

    // Wrap the one watched symbol in memory so the engine's warm-up and the
    // run-local indicator service's per-compute `watchlist.get` never hit the store.
    const symbol = await this.watchlist.get(params.symbolId);
    const watchlist = new InMemoryWatchlistRepository(symbol === null ? [] : [symbol]);

    const eventLog = new InMemoryEventLog();
    const state = new InMemoryStateRepository();
    const profiles = new InMemoryProfileRepository([profile]);
    const ruleRepository = new InMemoryRuleRepository(rulesForProfile, profiles);
    // The run-local indicator service reads the preloaded window, not the shared
    // store, so indicator warmup/compute reads stay in memory too.
    const indicators = this.makeIndicatorService(this.registry, watchlist, candles);
    const indicatorStore = new IndicatorSeriesStore(candles, indicators);
    await registerIndicatorInstances({ store: indicatorStore, profiles });

    const wired = await wireRuleEngine({
      rules: ruleRepository,
      oncePerBarLatch: new InMemoryOncePerBarLatchStore(),
      state,
      watchlist,
      notifier: new RecordingNoOpNotifier(),
      eventLog,
      candleRepository: candles,
      indicatorStore,
      // Backtest replays the finest period intrabar, so let a coarse-period
      // operand track the forming bar rolled up from those finer candles rather
      // than reading the last closed coarse bar (live keeps close-only bars).
      formIntrabarCoarseBars: true,
    });

    const executor = new BacktestExecutor(strategy, {
      initialCapital: params.initialCapital,
      commission: params.commission,
    });
    // Buffer the events each candle produces (its emission-order delta) so the
    // trading model sees exactly the events of the candle it just processed.
    const stepEvents: RuleEventEntry[] = [];
    const unsubscribe = eventLog.onAppend((entry, target) => {
      if (target.kind === 'symbol' && target.symbolId === params.symbolId) {
        stepEvents.push(entry);
      }
    });

    let sinceYield = 0;
    try {
      for (const item of feed) {
        if (hooks.isCancelled?.()) {
          return { events: [], trades: [], summary: emptyBacktestSummary(), cancelled: true };
        }
        feedCandleIntoEngine(wired, {
          id: params.symbolId,
          period: item.period,
          candle: item.candle,
          final: true,
        });
        await wired.drain();
        executor.processStep(
          item.candle,
          stepEvents.splice(0),
          item.candle.time + periodMillis(item.period),
        );
        hooks.onProgress?.(progressAt(item, params, totalDays));
        // Yield the event loop periodically so a concurrent progress poll is
        // served mid-run (the in-memory replay otherwise only awaits microtasks).
        sinceYield += 1;
        if (sinceYield >= YIELD_EVERY_CANDLES) {
          sinceYield = 0;
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
    } finally {
      unsubscribe();
    }

    hooks.onProgress?.({ elapsedDays: totalDays, totalDays });
    const outcome = executor.result();
    return {
      events: await eventLog.symbolEvents(params.symbolId),
      trades: outcome.trades,
      ...(outcome.openPosition === undefined ? {} : { openPosition: outcome.openPosition }),
      summary: outcome.summary,
      cancelled: false,
    };
  }

  /** Load every active period's in-range `[start, end)` candles from the preloaded window. */
  private async loadFeed(
    candles: CandleRepository,
    params: BacktestParams,
    periods: Period[],
  ): Promise<Array<{ period: Period; candles: readonly Candle[] }>> {
    return Promise.all(
      periods.map(async (period) => ({
        period,
        candles: await candles.range(params.symbolId, period, params.start, params.end),
      })),
    );
  }
}

/**
 * Merge each period's ascending-by-time candles into one feed ordered by
 * **completion time** (`time + periodMillis(period)`), ties broken
 * finest-period-first (smaller {@link periodMillis} first).
 *
 * A candle exists only once it has closed, so ordering by completion time means
 * a coarse bar never leaks its range before its finer bars have played out.
 *
 * Pure — exported for direct unit assertion of the ordering rule.
 *
 * @param perPeriod - each period paired with its stored candles (ascending by `time`).
 */
export function orderBacktestFeed(
  perPeriod: ReadonlyArray<{ period: Period; candles: readonly Candle[] }>,
): FeedCandle[] {
  const items: FeedCandle[] = perPeriod.flatMap(({ period, candles }) =>
    candles.map((candle) => ({ period, candle })),
  );
  return items.sort((a, b) => {
    const completionA = a.candle.time + periodMillis(a.period);
    const completionB = b.candle.time + periodMillis(b.period);
    if (completionA !== completionB) return completionA - completionB;
    return periodMillis(a.period) - periodMillis(b.period);
  });
}

/**
 * Compute the progress after feeding `item`: elapsed replay days from `start` to
 * the candle's completion time, clamped to `[0, totalDays]`.
 *
 * Pure — exported for direct unit assertion.
 */
export function progressAt(
  item: FeedCandle,
  params: Pick<BacktestParams, 'start' | 'end'>,
  totalDays: number,
): BacktestProgress {
  const completion = item.candle.time + periodMillis(item.period);
  const elapsedMs = Math.min(Math.max(completion - params.start, 0), params.end - params.start);
  return { elapsedDays: elapsedMs / DAY_MS, totalDays };
}

export { emptyBacktestSummary };
