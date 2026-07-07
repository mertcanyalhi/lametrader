import {
  type Backtest,
  type BacktestCommission,
  type BacktestDeltaFrame,
  type BacktestEventQuery,
  type BacktestEventRepository,
  type BacktestFrame,
  BacktestFrameKind,
  type BacktestOpenPosition,
  type BacktestParams,
  type BacktestProgress,
  type BacktestRepository,
  type BacktestSnapshotFrame,
  BacktestStatus,
  type BacktestStrategyRepository,
  type BacktestStreamCandle,
  type BacktestSummary,
  type BacktestTrade,
  type CandleRepository,
  type Period,
  type Profile,
  type ProfileRepository,
  type RuleEventEntry,
  type WatchlistRepository,
} from '@lametrader/core';
import { Logger } from '@nestjs/common';
import { nanoid } from 'nanoid';
import {
  activePeriods,
  assertProfileRunnable,
  assertStrategyRunnable,
  BacktestConflictError,
  BacktestError,
  BacktestNotFoundError,
  type BacktestRunRequest,
  generateBacktestName,
  validateRunWindow,
} from '../../common/domain/backtest.js';
import {
  type BacktestReplayPort,
  type BacktestReplayStep,
  emptyBacktestSummary,
} from './backtest-replay.service.js';

/** Milliseconds in a calendar day — the unit progress is reported in. */
const DAY_MS = 86_400_000;

/** Default flush cadence: emit a delta at most every this many candles. */
const DEFAULT_FLUSH_EVERY_CANDLES = 50;

/** Default flush cadence: emit a delta at least every this many milliseconds. */
const DEFAULT_FLUSH_EVERY_MS = 100;

/**
 * A backtest served from the in-memory job while it runs: the running
 * {@link Backtest} plus its live {@link BacktestProgress}.
 */
export type RunningBacktestView = Backtest & { progress: BacktestProgress };

/**
 * Injectable id generator + clock for {@link BacktestService}, so tests are
 * deterministic. Both default for production (nanoid / `Date.now`).
 */
export interface BacktestServiceOptions {
  /** Generate a new backtest id; defaults to nanoid. */
  newId?: () => string;
  /** Current epoch ms; defaults to `Date.now`. */
  now?: () => number;
  /**
   * Sink for per-run stream frames, keyed by backtest id — the transport hub's
   * `publish` in production, a recorder in tests. Omitted when nothing streams.
   */
  onFrame?: (id: string, frame: BacktestFrame) => void;
  /** Flush a delta once this many candles have queued (defaults to 50). */
  flushEveryCandles?: number;
  /** Flush a delta once this many ms have elapsed since the last flush (defaults to 100). */
  flushEveryMs?: number;
}

/**
 * The per-run streaming state accumulated as a replay advances, split into the
 * **flushed prefix** a late subscriber's snapshot is built from and the
 * **not-yet-flushed batch** the next delta frame carries.
 *
 * The split is what guarantees exactly-once delivery across a subscriber's
 * snapshot and the deltas that follow it: the snapshot fields hold only items
 * that have *already* been emitted in a delta, so the next delta — which carries
 * the pending items — re-sends nothing the snapshot already contained (no
 * duplication), while the subscriber, having subscribed before that delta fired,
 * still receives every pending item (no gap). On each flush the pending batch is
 * emitted, then folded into the flushed prefix and cleared.
 */
interface RunStreamState {
  /** Already-flushed run events — the snapshot's events prefix, in emission order. */
  events: RuleEventEntry[];
  /** Already-flushed closed trades — the snapshot's trades prefix, in exit order. */
  trades: BacktestTrade[];
  /** Summary over the already-flushed trades — the snapshot's summary. */
  summary: BacktestSummary;
  /** Open position as of the last flush — the snapshot's open position, if any. */
  openPosition?: BacktestOpenPosition;
  /** Progress as of the last flush — the snapshot's progress. */
  progress: BacktestProgress;
  /** Run-period candles fed since the last flushed delta. */
  pendingCandles: BacktestStreamCandle[];
  /** Run events recorded since the last flushed delta. */
  pendingEvents: RuleEventEntry[];
  /** Closed trades produced since the last flushed delta. */
  pendingTrades: BacktestTrade[];
  /** Latest running summary over all closed trades (flushed + pending) — the next delta's summary. */
  latestSummary: BacktestSummary;
  /** Latest open position (flushed + pending) — the next delta's open position, if any. */
  latestOpenPosition?: BacktestOpenPosition;
  /**
   * Replayed candles processed since the last flush, driving the candle-count
   * cadence. Counts every processed candle (all active periods), not just the
   * run-period ones the delta carries, so the flush pacing is unchanged by the
   * run-period candle filter.
   */
  stepsSinceFlush: number;
  /** Wall clock (epoch ms) of the last flushed delta, for the time-based cadence. */
  lastFlushAt: number;
}

/**
 * The one in-flight run's state (only one run may be active at a time).
 */
interface ActiveRun {
  /** The running backtest (status `Running`), served from memory until it completes. */
  backtest: Backtest;
  /** Live progress, updated as the replay advances. */
  progress: BacktestProgress;
  /** Set by a mid-run cancel; the replay stops and nothing is persisted. */
  cancelled: boolean;
  /** The profile whose rules drive the run. */
  profile: Profile;
  /** The symbol's active periods being replayed. */
  periods: Period[];
  /** The accumulated stream state (snapshot source + pending delta batch). */
  stream: RunStreamState;
}

/**
 * Application use-case for the {@link Backtest} resource and its server-side run
 * job.
 *
 * A run is validated synchronously (so client errors surface before the 202),
 * registered as the single active in-memory job, replayed in the background
 * through {@link BacktestReplayService}, and auto-persisted on completion under
 * the run's id with its events in their own collection. Only one run is active
 * at a time; a second start is a 409. Cancelling (or a run error) discards the
 * run entirely — nothing partial is persisted (jobs are in-memory; a restart
 * loses the active run, the same stance as backfill jobs).
 */
export class BacktestService {
  /** Scoped logger for the discard-on-error path. */
  private readonly logger = new Logger(BacktestService.name);
  /** Id generator (injectable; defaults to nanoid). */
  private readonly newId: () => string;
  /** Current clock (injectable; defaults to `Date.now`). */
  private readonly now: () => number;
  /** Per-run stream-frame sink (transport hub in production), or `undefined`. */
  private readonly onFrame?: (id: string, frame: BacktestFrame) => void;
  /** Flush a delta once this many candles have queued. */
  private readonly flushEveryCandles: number;
  /** Flush a delta once this many ms have elapsed since the last flush. */
  private readonly flushEveryMs: number;
  /** The single active run, or `null` when idle. */
  private active: ActiveRun | null = null;

  /**
   * @param backtests - the persisted-backtest store (completed runs only).
   * @param events - the run-events store, keyed by backtestId.
   * @param strategies - the strategy store (snapshotted at run time).
   * @param profiles - the profile store (enabled + scope validation, run rules).
   * @param watchlist - the watchlist (symbol existence + active periods).
   * @param candles - the candle store (in-range validation).
   * @param replay - the isolated replay engine.
   * @param options - injectable id generator and clock.
   */
  constructor(
    private readonly backtests: BacktestRepository,
    private readonly events: BacktestEventRepository,
    private readonly strategies: BacktestStrategyRepository,
    private readonly profiles: ProfileRepository,
    private readonly watchlist: WatchlistRepository,
    private readonly candles: CandleRepository,
    private readonly replay: BacktestReplayPort,
    options: BacktestServiceOptions = {},
  ) {
    this.newId = options.newId ?? (() => nanoid());
    this.now = options.now ?? Date.now;
    this.onFrame = options.onFrame;
    this.flushEveryCandles = options.flushEveryCandles ?? DEFAULT_FLUSH_EVERY_CANDLES;
    this.flushEveryMs = options.flushEveryMs ?? DEFAULT_FLUSH_EVERY_MS;
  }

  /**
   * Validate a run request, register it as the active job, kick the replay off
   * in the background, and return the `Running` backtest (served from memory).
   *
   * @throws {@link BacktestConflictError} when another run is already active (409).
   * @throws {@link BacktestNotFoundError} when the strategy / symbol / profile id is unknown (404).
   * @throws {@link BacktestError} on any invalid input (400).
   */
  async start(request: BacktestRunRequest): Promise<RunningBacktestView> {
    if (this.active !== null) {
      throw new BacktestConflictError('a backtest run is already active');
    }
    const strategy = await this.strategies.get(request.strategyId);
    if (strategy === null) {
      throw new BacktestNotFoundError(`backtest strategy not found: ${request.strategyId}`);
    }
    const profile = await this.profiles.get(request.profileId);
    if (profile === null) {
      throw new BacktestNotFoundError(`profile not found: ${request.profileId}`);
    }
    const symbol = await this.watchlist.get(request.symbolId);
    if (symbol === null) {
      throw new BacktestNotFoundError(`symbol not watched: ${request.symbolId}`);
    }
    validateRunWindow(request, this.now());
    assertStrategyRunnable(strategy);
    assertProfileRunnable(profile, request.symbolId);
    const periods = activePeriods(symbol);
    await this.assertCandlesInRange(request, periods);

    const ts = this.now();
    const params: BacktestParams = {
      symbolId: request.symbolId,
      profileId: request.profileId,
      profileName: profile.name,
      period: request.period,
      start: request.start,
      end: request.end,
      initialCapital: request.initialCapital,
      commission: normalizeCommission(request.commission),
    };
    const backtest: Backtest = {
      id: this.newId(),
      name: generateBacktestName(params, strategy.name),
      status: BacktestStatus.Running,
      createdAt: ts,
      updatedAt: ts,
      params,
      strategyId: strategy.id,
      strategy,
      trades: [],
      summary: emptyBacktestSummary(),
    };
    const active: ActiveRun = {
      backtest,
      progress: { elapsedDays: 0, totalDays: (params.end - params.start) / DAY_MS },
      cancelled: false,
      profile,
      periods,
      stream: {
        events: [],
        trades: [],
        summary: emptyBacktestSummary(),
        progress: { elapsedDays: 0, totalDays: (params.end - params.start) / DAY_MS },
        pendingCandles: [],
        pendingEvents: [],
        pendingTrades: [],
        latestSummary: emptyBacktestSummary(),
        stepsSinceFlush: 0,
        lastFlushAt: ts,
      },
    };
    this.active = active;
    void this.run(active);
    return this.runningView(active);
  }

  /**
   * List all backtests — the persisted completed runs with the in-memory running
   * one merged in — optionally filtered by `status`.
   */
  async list(status?: BacktestStatus): Promise<Array<Backtest | RunningBacktestView>> {
    const persisted = await this.backtests.list();
    const running = this.active === null ? [] : [this.runningView(this.active)];
    const merged: Array<Backtest | RunningBacktestView> = [...running, ...persisted];
    return status === undefined ? merged : merged.filter((b) => b.status === status);
  }

  /**
   * Get one backtest — the running one (with progress) when it is the active
   * run, else the persisted result.
   *
   * @throws {@link BacktestNotFoundError} when no such backtest exists (404).
   */
  async get(id: string): Promise<Backtest | RunningBacktestView> {
    if (this.active !== null && this.active.backtest.id === id) {
      return this.runningView(this.active);
    }
    return this.getPersisted(id);
  }

  /**
   * Rename a completed backtest.
   *
   * @throws {@link BacktestError} when the backtest is still running (400).
   * @throws {@link BacktestNotFoundError} when the id is unknown (404).
   */
  async rename(id: string, name: string): Promise<Backtest> {
    if (this.active !== null && this.active.backtest.id === id) {
      throw new BacktestError('cannot rename a running backtest');
    }
    const existing = await this.getPersisted(id);
    const renamed: Backtest = { ...existing, name, updatedAt: this.now() };
    await this.backtests.save(renamed);
    return renamed;
  }

  /**
   * Delete a backtest. A running backtest is cancelled and discarded (nothing is
   * persisted); a completed one is removed with its events cascaded.
   *
   * @throws {@link BacktestNotFoundError} when the id is unknown (404).
   */
  async remove(id: string): Promise<void> {
    if (this.active !== null && this.active.backtest.id === id) {
      this.active.cancelled = true;
      this.active = null;
      return;
    }
    await this.getPersisted(id);
    await this.backtests.remove(id);
    await this.events.removeForBacktest(id);
  }

  /**
   * Read a completed backtest's run events, windowed newest-first.
   *
   * @throws {@link BacktestError} when the backtest is still running (400) — an
   * in-flight run's events are served by the stream, not this endpoint.
   * @throws {@link BacktestNotFoundError} when the id is unknown (404).
   */
  async listEvents(id: string, query: BacktestEventQuery): Promise<RuleEventEntry[]> {
    if (this.active !== null && this.active.backtest.id === id) {
      throw new BacktestError('run events are not available while the backtest is running');
    }
    await this.getPersisted(id);
    return this.events.window(id, query);
  }

  /** Read one persisted backtest or throw {@link BacktestNotFoundError}. */
  private async getPersisted(id: string): Promise<Backtest> {
    const backtest = await this.backtests.get(id);
    if (backtest === null) {
      throw new BacktestNotFoundError(`backtest not found: ${id}`);
    }
    return backtest;
  }

  /** Assert at least one candle is stored in `[start, end)` across the active periods. */
  private async assertCandlesInRange(
    request: BacktestRunRequest,
    periods: Period[],
  ): Promise<void> {
    for (const period of periods) {
      const found = await this.candles.range(
        request.symbolId,
        period,
        request.start,
        request.end,
        1,
      );
      if (found.length > 0) return;
    }
    throw new BacktestError('no stored candles in the requested range; backfill the symbol first');
  }

  /** Run the replay to completion, then persist — or discard on cancel / error. */
  private async run(active: ActiveRun): Promise<void> {
    try {
      const result = await this.replay.replay(
        active.backtest.params,
        active.backtest.strategy,
        active.profile,
        active.periods,
        {
          onProgress: (progress) => {
            active.progress = progress;
          },
          onStep: (step) => this.accumulateStep(active, step),
          isCancelled: () => active.cancelled,
        },
      );
      if (active.cancelled || result.cancelled) {
        this.clearActive(active);
        return;
      }
      const completed: Backtest = {
        ...active.backtest,
        status: BacktestStatus.Completed,
        updatedAt: this.now(),
        trades: result.trades,
        ...(result.openPosition === undefined ? {} : { openPosition: result.openPosition }),
        summary: result.summary,
      };
      // Persist BEFORE the final frame so a client receiving `Completed` can
      // immediately fetch the saved result at the same id.
      await this.backtests.save(completed);
      await this.events.append(completed.id, result.events);
      this.flush(active, BacktestStatus.Completed);
      this.clearActive(active);
    } catch (error) {
      this.logger.error(
        `backtest run ${active.backtest.id} failed and was discarded`,
        error instanceof Error ? error.stack : String(error),
      );
      this.clearActive(active);
    }
  }

  /** Free the active-run slot if `active` is still the current run. */
  private clearActive(active: ActiveRun): void {
    if (this.active === active) {
      this.active = null;
    }
  }

  /** The running backtest with its live progress attached. */
  private runningView(active: ActiveRun): RunningBacktestView {
    return { ...active.backtest, progress: active.progress };
  }

  /**
   * The snapshot frame for the currently active run `id`, or `null` when `id` is
   * not the active run.
   *
   * Synchronous by design: the stream gateway reads it and subscribes to the hub
   * in one uninterrupted step, so a delta published between cannot slip ahead of
   * the snapshot.
   *
   * Reflects only the **flushed prefix** — the trades, events, summary, open
   * position, and progress as of the last emitted delta. Items produced since
   * (still pending) are deliberately excluded: the subscriber, having subscribed
   * before the next flush, receives them once in that delta, so the union of the
   * snapshot and the deltas that follow it contains each trade and event exactly
   * once.
   */
  activeSnapshotFrame(id: string): BacktestSnapshotFrame | null {
    if (this.active === null || this.active.backtest.id !== id) {
      return null;
    }
    const stream = this.active.stream;
    return {
      kind: BacktestFrameKind.Snapshot,
      status: BacktestStatus.Running,
      progress: stream.progress,
      params: this.active.backtest.params,
      trades: [...stream.trades],
      summary: stream.summary,
      ...(stream.openPosition === undefined ? {} : { openPosition: stream.openPosition }),
      events: [...stream.events],
    };
  }

  /**
   * The snapshot frame for a persisted (completed) backtest `id`, or `null` when
   * no such backtest exists — the frame a client gets when it subscribes after
   * the run has already finished.
   */
  async persistedSnapshotFrame(id: string): Promise<BacktestSnapshotFrame | null> {
    const backtest = await this.backtests.get(id);
    if (backtest === null) {
      return null;
    }
    const totalDays = (backtest.params.end - backtest.params.start) / DAY_MS;
    const events = await this.events.list(id);
    return {
      kind: BacktestFrameKind.Snapshot,
      status: backtest.status,
      progress: { elapsedDays: totalDays, totalDays },
      params: backtest.params,
      trades: backtest.trades,
      summary: backtest.summary,
      ...(backtest.openPosition === undefined ? {} : { openPosition: backtest.openPosition }),
      events,
    };
  }

  /**
   * Fold one replay step into the run's **pending** batch, then flush a delta
   * once the candle-count or time cadence trips.
   *
   * The step's events and trades join only the pending batch (never the flushed
   * prefix directly) so a snapshot taken before the next flush cannot contain
   * them — {@link flush} folds them into the prefix as it emits them. Every
   * active period's candle is processed, but only a **run-period** candle enters
   * the streamed batch (spec: *Stream protocol* — deltas carry new run-period
   * candles); the candle-count cadence still counts every processed candle.
   */
  private accumulateStep(active: ActiveRun, step: BacktestReplayStep): void {
    const stream = active.stream;
    stream.pendingEvents.push(...step.events);
    stream.pendingTrades.push(...step.trades);
    stream.latestSummary = step.summary;
    if (step.openPosition === undefined) {
      delete stream.latestOpenPosition;
    } else {
      stream.latestOpenPosition = step.openPosition;
    }
    if (step.candle.period === active.backtest.params.period) {
      stream.pendingCandles.push({ period: step.candle.period, candle: step.candle.candle });
    }
    stream.stepsSinceFlush += 1;
    active.progress = step.progress;
    if (
      stream.stepsSinceFlush >= this.flushEveryCandles ||
      this.now() - stream.lastFlushAt >= this.flushEveryMs
    ) {
      this.flush(active, BacktestStatus.Running);
    }
  }

  /**
   * Publish a delta frame carrying the pending batch and the run's current
   * `status`, then fold that batch into the flushed prefix and reset it. The
   * final flush (`Completed`) always emits, even with an empty batch, so
   * subscribers always see a terminal frame.
   *
   * The order is load-bearing: the delta is emitted **before** the pending items
   * move into the flushed prefix, so a subscriber that reads the snapshot after
   * this flush sees the items in its snapshot (flushed) rather than twice (once
   * in the snapshot and again in this delta).
   */
  private flush(active: ActiveRun, status: BacktestStatus): void {
    const stream = active.stream;
    const frame: BacktestDeltaFrame = {
      kind: BacktestFrameKind.Delta,
      status,
      progress: active.progress,
      candles: stream.pendingCandles,
      events: stream.pendingEvents,
      trades: stream.pendingTrades,
      summary: stream.latestSummary,
      ...(stream.latestOpenPosition === undefined
        ? {}
        : { openPosition: stream.latestOpenPosition }),
    };
    this.onFrame?.(active.backtest.id, frame);
    stream.events.push(...stream.pendingEvents);
    stream.trades.push(...stream.pendingTrades);
    stream.summary = stream.latestSummary;
    if (stream.latestOpenPosition === undefined) {
      delete stream.openPosition;
    } else {
      stream.openPosition = stream.latestOpenPosition;
    }
    stream.progress = active.progress;
    stream.pendingCandles = [];
    stream.pendingEvents = [];
    stream.pendingTrades = [];
    stream.stepsSinceFlush = 0;
    stream.lastFlushAt = this.now();
  }
}

/**
 * Normalize a request's commission to carry only the fields actually supplied
 * (an omitted `rate` / `fixed` stays omitted, not an explicit `undefined`).
 */
function normalizeCommission(commission: BacktestCommission): BacktestCommission {
  return {
    ...(commission.rate === undefined ? {} : { rate: commission.rate }),
    ...(commission.fixed === undefined ? {} : { fixed: commission.fixed }),
  };
}
