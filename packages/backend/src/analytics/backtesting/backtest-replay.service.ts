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
import { InMemoryCandleRepository } from '../../market/persistence/in-memory-candle.repository.js';
import { IndicatorService } from '../indicators/indicator.service.js';
import { InMemoryProfileRepository } from '../persistence/in-memory-profile.repository.js';
import { InMemoryStateRepository } from '../persistence/in-memory-state.repository.js';
import { InMemoryOncePerBarLatchStore } from '../rules/dispatch/in-memory-once-per-bar-latch.store.js';
import { InMemoryRuleRepository } from '../rules/in-memory-rule.repository.js';
import { IndicatorSeriesStore } from '../rules/indicator-series-store.js';
import { registerIndicatorInstances } from '../rules/wire/register-indicator-instances.js';
import { feedCandleIntoEngine, wireRuleEngine } from '../rules/wire/wire-rule-engine.js';
import { BacktestExecutor, emptyBacktestSummary } from './backtest-executor.js';

/** Milliseconds in a calendar day — the unit progress is reported in. */
const DAY_MS = 86_400_000;

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
 * One replayed candle's incremental outcome, handed to
 * {@link BacktestReplayHooks.onStep} after the candle is processed so the job
 * layer can stream batched deltas without the replay knowing about transport.
 *
 * `candle` and `events` are the just-processed candle and the events it
 * produced; `trades` are the closed trades this candle newly produced (not the
 * cumulative set); `summary`, `openPosition`, and `progress` are the run's
 * current values after this candle.
 */
export interface BacktestReplayStep {
  /** The candle just processed, tagged with its period, in completion order. */
  candle: FeedCandle;
  /** The symbol-scoped run events this candle produced, in emission order. */
  events: RuleEventEntry[];
  /** The closed trades this candle produced (new since the previous step). */
  trades: BacktestTrade[];
  /** The running summary over all closed trades so far. */
  summary: BacktestSummary;
  /** The position open after this candle, if any. */
  openPosition?: BacktestOpenPosition;
  /** Replay progress after this candle. */
  progress: BacktestProgress;
}

/**
 * Hooks the {@link BacktestReplayService} calls back into during a replay so the
 * job layer can track progress, stream deltas, and cancel mid-run without the
 * replay knowing about the job at all.
 */
export interface BacktestReplayHooks {
  /** Reports replay progress after each fed candle (and once at the ends). */
  onProgress?: (progress: BacktestProgress) => void;
  /** Reports one candle's incremental outcome after it is processed (for streaming). */
  onStep?: (step: BacktestReplayStep) => void;
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
 * Builds the run-local {@link IndicatorService} a replay computes indicators
 * through, over the in-memory store preloaded for that run.
 *
 * A backtest resolves every indicator from its preloaded candle copy, not the
 * shared Mongo-backed store, so the service is constructed per run over that copy
 * rather than injected pre-built (an {@link IndicatorService} reads candles from
 * the repository it was constructed with). Production binds a factory over the
 * shared indicator registry + watchlist; a test substitutes a recording variant.
 */
export type ReplayIndicatorServiceFactory = (candles: CandleRepository) => IndicatorService;

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
 * Before replaying, the run copies the symbol's full stored history up to `end`
 * into a private in-memory candle store and resolves every read — the feed, the
 * bar-series pagers, and a run-local indicator service's warmup — from that copy
 * (ADR-0022). The shared candle store is read once, up front, never during a
 * drain, so a run contends with no live write while pre-`start` lookbacks stay
 * byte-identical to the live path with no fixed warm-up window.
 */
export class BacktestReplayService implements BacktestReplayPort {
  /**
   * @param candles - the shared candle store, read once to seed the run's in-memory copy.
   * @param rules - the shared rule store; the run seeds a fresh engine with the profile's rules.
   * @param watchlist - the shared watchlist (read for the engine's `AllSymbols` fan-out + warm-up).
   * @param makeIndicators - builds the run-local indicator service over the preloaded in-memory store.
   */
  constructor(
    private readonly candles: CandleRepository,
    private readonly rules: RuleRepository,
    private readonly watchlist: WatchlistRepository,
    private readonly makeIndicators: ReplayIndicatorServiceFactory,
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
    const candles = await this.preload(params, periods);
    const feed = await this.loadFeed(candles, params, periods);
    const totalDays = (params.end - params.start) / DAY_MS;
    hooks.onProgress?.({ elapsedDays: 0, totalDays });

    const eventLog = new InMemoryEventLog();
    const state = new InMemoryStateRepository();
    const profiles = new InMemoryProfileRepository([profile]);
    const rulesForProfile = (await this.rules.list()).filter(
      (rule) => rule.profileId === profile.id,
    );
    const ruleRepository = new InMemoryRuleRepository(rulesForProfile, profiles);
    // Every candle read — the feed, the bar-series pagers, and the run-local
    // indicator warmup — resolves from the preloaded in-memory store, so a drain
    // touches no shared collaborator and contends with no live write (ADR-0022).
    const indicators = this.makeIndicators(candles);
    const indicatorStore = new IndicatorSeriesStore(candles, indicators);
    await registerIndicatorInstances({ store: indicatorStore, profiles });

    const wired = await wireRuleEngine({
      rules: ruleRepository,
      oncePerBarLatch: new InMemoryOncePerBarLatchStore(),
      state,
      watchlist: this.watchlist,
      notifier: new RecordingNoOpNotifier(),
      eventLog,
      candleRepository: candles,
      indicatorStore,
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

    // How many closed trades have already been reported through onStep, so each
    // step emits only the trades that candle newly produced.
    let reportedTrades = 0;
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
        const candleEvents = stepEvents.splice(0);
        executor.processStep(item.candle, candleEvents);
        const progress = progressAt(item, params, totalDays);
        const stepResult = executor.result();
        const newTrades = stepResult.trades.slice(reportedTrades);
        reportedTrades = stepResult.trades.length;
        hooks.onStep?.({
          candle: item,
          events: candleEvents,
          trades: newTrades,
          summary: stepResult.summary,
          ...(stepResult.openPosition === undefined
            ? {}
            : { openPosition: stepResult.openPosition }),
          progress,
        });
        hooks.onProgress?.(progress);
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

  /**
   * Copy the symbol's full stored history up to `end`, across the active periods,
   * into a fresh in-memory store — the single source every replay read resolves
   * from.
   *
   * Loads everything below `end` (not just `[start, end)`) so every pre-`start`
   * lookback and indicator warmup resolves to exactly what the live path would
   * read from the shared store — parity by construction, no sized warm-up window
   * that could silently under-read. The run's window is validated to stay within
   * `MAX_REPLAY_CANDLES` before it starts, so this copy is bounded.
   */
  private async preload(
    params: BacktestParams,
    periods: Period[],
  ): Promise<InMemoryCandleRepository> {
    const preloaded = new InMemoryCandleRepository();
    await Promise.all(
      periods.map(async (period) => {
        const history = await this.candles.range(
          params.symbolId,
          period,
          Number.MIN_SAFE_INTEGER,
          params.end,
        );
        await preloaded.save(params.symbolId, period, history);
      }),
    );
    return preloaded;
  }

  /** Order every active period's `[start, end)` candles, read from `source`, into one feed. */
  private async loadFeed(
    source: CandleRepository,
    params: BacktestParams,
    periods: Period[],
  ): Promise<FeedCandle[]> {
    const perPeriod = await Promise.all(
      periods.map(async (period) => ({
        period,
        candles: await source.range(params.symbolId, period, params.start, params.end),
      })),
    );
    return orderBacktestFeed(perPeriod);
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
