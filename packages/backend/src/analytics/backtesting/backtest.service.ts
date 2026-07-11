import {
  type Backtest,
  type BacktestCommission,
  type BacktestEventQuery,
  type BacktestEventRepository,
  type BacktestParams,
  type BacktestProgress,
  type BacktestRepository,
  BacktestStatus,
  type BacktestStrategyRepository,
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
import { type BacktestReplayPort, emptyBacktestSummary } from './backtest-replay.service.js';

/** Milliseconds in a calendar day — the unit progress is reported in. */
const DAY_MS = 86_400_000;

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
}

/**
 * The one in-flight run's state (only one run may be active at a time).
 */
interface ActiveRun {
  /** The running backtest (status `Running`), served from memory until it completes. */
  backtest: Backtest;
  /** Live progress, updated as the replay advances and read by `GET /backtests/:id` polling. */
  progress: BacktestProgress;
  /** Set by a mid-run cancel; the replay stops and nothing is persisted. */
  cancelled: boolean;
  /** The profile whose rules drive the run. */
  profile: Profile;
  /** The symbol's active periods being replayed. */
  periods: Period[];
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
 *
 * The run publishes no stream (ADR-0022): a client watches progress by polling
 * `GET /backtests/:id` until the status flips to `Completed`, then reads the
 * persisted result and its windowed events.
 */
export class BacktestService {
  /** Scoped logger for the discard-on-error path. */
  private readonly logger = new Logger(BacktestService.name);
  /** Id generator (injectable; defaults to nanoid). */
  private readonly newId: () => string;
  /** Current clock (injectable; defaults to `Date.now`). */
  private readonly now: () => number;
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
   * in-flight run's events are persisted only on completion.
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
      // Persist the result and its events before freeing the slot, so a client
      // that next polls `Completed` can immediately fetch them at the same id.
      await this.backtests.save(completed);
      await this.events.append(completed.id, result.events);
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
