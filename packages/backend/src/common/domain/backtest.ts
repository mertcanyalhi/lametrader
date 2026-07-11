import {
  type BacktestCommission,
  type BacktestParams,
  type BacktestStrategy,
  type Period,
  type Profile,
  ProfileScope,
  type WatchedSymbol,
} from '@lametrader/core';

/**
 * Raised when a backtest run request fails validation (bad dates, non-positive
 * capital, a negative commission, an incomplete strategy, or a disabled /
 * out-of-scope profile).
 *
 * Distinct type so driving adapters map it to a client error (HTTP 400) rather
 * than a server fault.
 */
export class BacktestError extends Error {
  /**
   * @param message - the human-readable validation failure reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'BacktestError';
  }
}

/**
 * Raised when a backtest does not exist (on get/rename/delete/events).
 *
 * Driving adapters map it to HTTP 404.
 */
export class BacktestNotFoundError extends Error {
  /**
   * @param message - the human-readable not-found reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'BacktestNotFoundError';
  }
}

/**
 * Raised when a backtest run is started while another run is already active
 * (only one run at a time), or when an operation is invalid for the backtest's
 * current status (renaming or reading events of a still-running run).
 *
 * The active-run case maps to HTTP 409; the status-invalid case is raised as a
 * {@link BacktestError} instead (400) — see the run service.
 */
export class BacktestConflictError extends Error {
  /**
   * @param message - the human-readable conflict reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'BacktestConflictError';
  }
}

/**
 * The typed, shape-validated inputs of a run request — everything a
 * `POST /backtests` body carries after DTO validation, before the domain /
 * cross-resource checks run.
 */
export interface BacktestRunRequest {
  /** The source strategy id. */
  strategyId: string;
  /** The watched symbol to replay. */
  symbolId: string;
  /** The profile whose rules drive the run. */
  profileId: string;
  /** The chart period the run is anchored to. */
  period: Period;
  /** Replay window start, epoch milliseconds (inclusive). */
  start: number;
  /** Replay window end, epoch milliseconds (exclusive). */
  end: number;
  /** Starting equity. */
  initialCapital: number;
  /** The per-fill commission model. */
  commission: BacktestCommission;
}

/**
 * Validate the run window, capital, and commission — the single-input business
 * rules that do not need any other resource.
 *
 * `start < end`, `end ≤ now`, `initialCapital > 0`, and both commission values
 * (when present) `≥ 0`.
 *
 * @throws {@link BacktestError} on any violated rule.
 */
export function validateRunWindow(request: BacktestRunRequest, now: number): void {
  if (!(request.start < request.end)) {
    throw new BacktestError('start must be before end');
  }
  if (!(request.end <= now)) {
    throw new BacktestError('end must not be in the future');
  }
  if (!(request.initialCapital > 0)) {
    throw new BacktestError('initialCapital must be greater than zero');
  }
  if (request.commission.rate !== undefined && request.commission.rate < 0) {
    throw new BacktestError('commission rate must not be negative');
  }
  if (request.commission.fixed !== undefined && request.commission.fixed < 0) {
    throw new BacktestError('commission fixed must not be negative');
  }
}

/**
 * Assert the snapshotted strategy is runnable: it defines an entry signal and at
 * least one exit mechanism.
 *
 * Stored strategies always satisfy this (the strategy store enforces it), so the
 * check is defensive — a strategy edited to an invalid shape by a future flow
 * still fails run start cleanly rather than mid-replay.
 *
 * @throws {@link BacktestError} when the strategy is incomplete.
 */
export function assertStrategyRunnable(strategy: BacktestStrategy): void {
  if (strategy.entry?.signal === undefined) {
    throw new BacktestError('strategy must define an entry signal');
  }
  const { exit } = strategy;
  if (
    exit === undefined ||
    (exit.signal === undefined && exit.profitTarget === undefined && exit.stopLoss === undefined)
  ) {
    throw new BacktestError('strategy must define at least one exit mechanism');
  }
}

/**
 * Assert the profile is enabled and its scope includes the symbol.
 *
 * @throws {@link BacktestError} when the profile is disabled or out of scope.
 */
export function assertProfileRunnable(profile: Profile, symbolId: string): void {
  if (!profile.enabled) {
    throw new BacktestError('profile is disabled');
  }
  const inScope =
    profile.scope.type === ProfileScope.All || profile.scope.symbolIds.includes(symbolId);
  if (!inScope) {
    throw new BacktestError('profile scope does not include the symbol');
  }
}

/**
 * The active periods a run replays for a symbol — its watched
 * {@link WatchedSymbol.periods}.
 */
export function activePeriods(symbol: WatchedSymbol): Period[] {
  return symbol.periods;
}

/**
 * The most candles a single backtest may preload into memory, summed across its
 * active periods.
 *
 * A run replays from a fully in-memory copy of the symbol's stored history up to
 * `end` (ADR-0022), so its resident memory scales with that history. At the
 * coarse, bounded scale this platform runs (a year or two at 1h / 1d) a run is
 * tens of thousands of rows; this cap sits far above any legitimate run yet well
 * under memory pressure, so a mis-entered fine-grained run (years of 1-minute
 * bars) fails fast with a clear 400 instead of OOM-ing the single in-process run.
 *
 * A fixed constant on purpose — lift to `@nestjs/config` only on a second need.
 */
export const MAX_REPLAY_CANDLES = 1_000_000;

/**
 * Assert a run's preload stays within {@link MAX_REPLAY_CANDLES}: the summed
 * candle count across its active periods must not exceed `cap`.
 *
 * Pure — the caller supplies each active period's stored-candle count (an index
 * count, no candles materialized) so the guard runs before the preload it
 * guards.
 *
 * @param perPeriodCounts - each active period's stored-candle count up to `end`.
 * @param cap - the inclusive upper bound on the summed count.
 * @throws {@link BacktestError} when the summed count exceeds `cap` (→ 400).
 */
export function assertReplayCandleBudget(perPeriodCounts: readonly number[], cap: number): void {
  const total = perPeriodCounts.reduce((sum, count) => sum + count, 0);
  if (total > cap) {
    throw new BacktestError(
      `backtest window is too large: ${total} candles exceed the ${cap} cap — narrow the range or drop a period`,
    );
  }
}

/**
 * Generate a backtest's auto name: `{strategy} · {symbol} · {period} ·
 * {start}→{end}` with UTC calendar dates.
 *
 * The window bounds render as `YYYY-MM-DD` in UTC so the name is stable across
 * the viewer's timezone.
 */
export function generateBacktestName(
  params: Pick<BacktestParams, 'symbolId' | 'period' | 'start' | 'end'>,
  strategyName: string,
): string {
  const start = utcDate(params.start);
  const end = utcDate(params.end);
  return `${strategyName} · ${params.symbolId} · ${params.period} · ${start}→${end}`;
}

/** Format an epoch-ms instant as a UTC `YYYY-MM-DD` calendar date. */
function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
