import {
  type BacktestCommission,
  BacktestExitReason,
  type BacktestOpenPosition,
  type BacktestSignal,
  type BacktestStrategyEntry,
  type BacktestStrategyExit,
  type BacktestSummary,
  type BacktestThreshold,
  BacktestThresholdKind,
  type BacktestTrade,
  type Candle,
  type RuleEventEntry,
  RuleEventType,
  StateScope,
  type StateValue,
} from '@lametrader/core';

/** Milliseconds in a calendar day — the unit `avgDaysInTrade` is reported in. */
const DAY_MS = 86_400_000;

/**
 * The subset of a strategy the trading model needs: its entry and exit
 * definitions (a run passes the full snapshot, which structurally satisfies
 * this).
 */
export interface BacktestExecutorStrategy {
  /** The transition that opens a position while flat. */
  entry: BacktestStrategyEntry;
  /** The exit definition — signal and/or profit-target and/or stop-loss. */
  exit: BacktestStrategyExit;
}

/**
 * The run inputs the trading model sizes and charges against: starting equity
 * and the per-fill commission model.
 */
export interface BacktestExecutorParams {
  /** Starting equity for the run (all-in per entry). */
  initialCapital: number;
  /** The commission model applied per fill. */
  commission: BacktestCommission;
}

/**
 * The trading-model output over a replay: the closed round trips, the position
 * still open at the end (if any), and the summary over the closed trades.
 */
export interface BacktestExecutorResult {
  /** Closed round trips, in exit order. */
  trades: BacktestTrade[];
  /** The position still open at the end, if any. */
  openPosition?: BacktestOpenPosition;
  /** Aggregate metrics over the closed trades. */
  summary: BacktestSummary;
}

/**
 * The internal bookkeeping for the one open position: the public
 * {@link BacktestOpenPosition} fields plus the `notional` (entry cost basis less
 * the entry commission) needed to compute exit P/L.
 */
interface OpenLot {
  /** Entry fill time, epoch milliseconds. */
  entryTs: number;
  /** Entry fill price. */
  entryPrice: number;
  /** Position size (fractional). */
  quantity: number;
  /** Capital deployed into the position, excluding entry commission. */
  notional: number;
  /** Commission paid on the entry fill. */
  entryCommission: number;
}

/**
 * The long-only, one-position, all-in compounding trade executor — turns a
 * replay's ordered candles and the engine events each produced into closed
 * {@link BacktestTrade}s, an {@link BacktestOpenPosition}, and a
 * {@link BacktestSummary} (spec: *Run semantics → Trading model*).
 *
 * Fed one candle at a time in completion order through {@link processStep}: each
 * step first checks the entry-relative profit-target / stop-loss levels against
 * the candle's high/low (stop-loss before profit-target), then consumes that
 * candle's `StateSet` events in emission order (an edge-triggered entry signal
 * opens while flat; an exit signal closes at the candle's close). Because the
 * level check runs before the events, the entry candle is never checked against
 * its own levels — they apply from the next processed candle onward.
 *
 * Independent of the engine: the run wires it, but it is driven purely by
 * candles + events so the trading rules are unit-tested without a real engine.
 */
export class BacktestExecutor {
  /** The starting equity, retained for the summary's `roiPct`. */
  private readonly initialCapital: number;
  /** Running equity — spent whole at entry, restored (plus P/L) at exit. */
  private equity: number;
  /** The per-fill commission model. */
  private readonly commission: BacktestCommission;
  /** The transition that opens a position while flat. */
  private readonly entrySignal: BacktestSignal;
  /** The exit definition (signal / profit-target / stop-loss). */
  private readonly exit: BacktestStrategyExit;
  /** Closed round trips, in exit order. */
  private readonly trades: BacktestTrade[] = [];
  /** The one open position, or `null` while flat. */
  private position: OpenLot | null = null;
  /** Close of the last processed candle — the open position's mark price. */
  private lastClose = 0;
  /** Last observed value per state key, to detect edge transitions. */
  private readonly lastValues = new Map<string, StateValue>();

  /**
   * @param strategy - the run's entry/exit definition (a full snapshot satisfies it).
   * @param params - the starting equity and commission model.
   */
  constructor(strategy: BacktestExecutorStrategy, params: BacktestExecutorParams) {
    this.initialCapital = params.initialCapital;
    this.equity = params.initialCapital;
    this.commission = params.commission;
    this.entrySignal = strategy.entry.signal;
    this.exit = strategy.exit;
  }

  /**
   * Advance the trading model by one candle: check the levels against its
   * high/low (only when a position is open — the entry candle is thus exempt),
   * then consume its `StateSet` events in emission order for entry/exit signals.
   *
   * @param candle - the candle just processed, in completion order.
   * @param events - the symbol-scoped run events this candle produced, in emission order.
   */
  processStep(candle: Candle, events: readonly RuleEventEntry[]): void {
    this.lastClose = candle.close;
    if (this.position !== null) {
      const level = this.levelExit(candle, this.position);
      if (level !== null) {
        this.closePosition(candle.time, level.price, level.reason);
      }
    }
    for (const event of events) {
      if (event.type !== RuleEventType.StateSet || event.scope !== StateScope.Symbol) {
        continue;
      }
      if (!this.recordTransition(event.key, event.value)) {
        continue;
      }
      if (this.position !== null) {
        if (
          this.exit.signal !== undefined &&
          signalMatches(this.exit.signal, event.key, event.value)
        ) {
          this.closePosition(candle.time, candle.close, BacktestExitReason.Signal);
        }
      } else if (signalMatches(this.entrySignal, event.key, event.value)) {
        this.openPosition(candle.time, candle.close);
      }
    }
  }

  /**
   * The trading-model result so far — the closed trades, the open position (if
   * any) marked to the last processed close, and the summary over the closed
   * trades.
   */
  result(): BacktestExecutorResult {
    const summary = summarizeTrades(this.trades, this.initialCapital);
    if (this.position === null) {
      return { trades: this.trades, summary };
    }
    const pos = this.position;
    const unrealizedPnl = pos.quantity * this.lastClose - (pos.notional + pos.entryCommission);
    return {
      trades: this.trades,
      openPosition: {
        entryTs: pos.entryTs,
        entryPrice: pos.entryPrice,
        quantity: pos.quantity,
        entryCommission: pos.entryCommission,
        unrealizedPnl,
      },
      summary,
    };
  }

  /**
   * The intrabar level exit for `candle` against the open `pos`, or `null` — the
   * stop-loss is checked before the profit-target, so a candle spanning both
   * resolves stop-first. The fill is at the level itself.
   */
  private levelExit(
    candle: Candle,
    pos: OpenLot,
  ): { price: number; reason: BacktestExitReason } | null {
    if (this.exit.stopLoss !== undefined) {
      const level = stopLossLevel(pos.entryPrice, this.exit.stopLoss);
      if (candle.low <= level) {
        return { price: level, reason: BacktestExitReason.StopLoss };
      }
    }
    if (this.exit.profitTarget !== undefined) {
      const level = profitTargetLevel(pos.entryPrice, this.exit.profitTarget);
      if (candle.high >= level) {
        return { price: level, reason: BacktestExitReason.ProfitTarget };
      }
    }
    return null;
  }

  /**
   * Open a whole-equity position at `entryPrice`, cash-constrained including
   * commission: `notional = (equity − fixed) / (1 + rate/100)`, so the entry
   * commission plus notional consume the full equity.
   */
  private openPosition(entryTs: number, entryPrice: number): void {
    const rate = this.commission.rate ?? 0;
    const fixed = this.commission.fixed ?? 0;
    const notional = (this.equity - fixed) / (1 + rate / 100);
    const quantity = notional / entryPrice;
    const entryCommission = notional * (rate / 100) + fixed;
    this.position = { entryTs, entryPrice, quantity, notional, entryCommission };
  }

  /**
   * Sell the whole position at `exitPrice`, record the net trade, and compound
   * the proceeds back into equity for the next entry.
   */
  private closePosition(exitTs: number, exitPrice: number, reason: BacktestExitReason): void {
    if (this.position === null) {
      return;
    }
    const pos = this.position;
    const rate = this.commission.rate ?? 0;
    const fixed = this.commission.fixed ?? 0;
    const grossProceeds = pos.quantity * exitPrice;
    const exitCommission = grossProceeds * (rate / 100) + fixed;
    const commission = pos.entryCommission + exitCommission;
    const costBasis = pos.notional + pos.entryCommission;
    const pnl = grossProceeds - exitCommission - costBasis;
    const roiPct = (pnl / costBasis) * 100;
    this.trades.push({
      entryTs: pos.entryTs,
      exitTs,
      entryPrice: pos.entryPrice,
      exitPrice,
      quantity: pos.quantity,
      commission,
      pnl,
      roiPct,
      exitReason: reason,
    });
    this.equity += pnl;
    this.position = null;
  }

  /**
   * Record the latest value for `key` and report whether it is an edge
   * transition (a change from the previous value — the first write always is).
   */
  private recordTransition(key: string, value: StateValue): boolean {
    const prev = this.lastValues.get(key);
    this.lastValues.set(key, value);
    return prev === undefined || !stateValuesEqual(prev, value);
  }
}

/**
 * The profit-target price level, entry-relative per its
 * {@link BacktestThresholdKind}: `Fixed` adds the amount, `Percentage` scales by
 * `1 + amount/100`.
 */
function profitTargetLevel(entryPrice: number, threshold: BacktestThreshold): number {
  return threshold.kind === BacktestThresholdKind.Fixed
    ? entryPrice + threshold.amount
    : entryPrice * (1 + threshold.amount / 100);
}

/**
 * The stop-loss price level, entry-relative per its
 * {@link BacktestThresholdKind}: `Fixed` subtracts the amount, `Percentage`
 * scales by `1 − amount/100`.
 */
function stopLossLevel(entryPrice: number, threshold: BacktestThreshold): number {
  return threshold.kind === BacktestThresholdKind.Fixed
    ? entryPrice - threshold.amount
    : entryPrice * (1 - threshold.amount / 100);
}

/**
 * Whether a `StateSet` of `key = value` satisfies `signal` — same key and an
 * equal tagged value.
 */
function signalMatches(signal: BacktestSignal, key: string, value: StateValue): boolean {
  return signal.key === key && stateValuesEqual(signal.value, value);
}

/** Structural equality for two tagged {@link StateValue}s (same type and data). */
function stateValuesEqual(a: StateValue, b: StateValue): boolean {
  return a.type === b.type && a.value === b.value;
}

/**
 * Aggregate {@link BacktestSummary} over a run's **closed trades only** (spec:
 * *Domain model → Summary*).
 *
 * `winners`/`losers` count strictly-positive / strictly-negative P/L (an
 * exact-zero trade counts in `tradeCount` but neither bucket); the averages are
 * `0` with no trades, and `roiPct` is `0` when `initialCapital` is non-positive
 * (the empty-run placeholder).
 *
 * @param trades - the closed trades to aggregate.
 * @param initialCapital - the run's starting equity, for `roiPct`.
 */
export function summarizeTrades(
  trades: readonly BacktestTrade[],
  initialCapital: number,
): BacktestSummary {
  const tradeCount = trades.length;
  const totalPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);
  const winners = trades.filter((trade) => trade.pnl > 0).length;
  const losers = trades.filter((trade) => trade.pnl < 0).length;
  const roiPct = initialCapital > 0 ? (totalPnl / initialCapital) * 100 : 0;
  const avgPnlPerTrade = tradeCount === 0 ? 0 : totalPnl / tradeCount;
  const avgRoiPct =
    tradeCount === 0 ? 0 : trades.reduce((sum, trade) => sum + trade.roiPct, 0) / tradeCount;
  const avgDaysInTrade =
    tradeCount === 0
      ? 0
      : trades.reduce((sum, trade) => sum + (trade.exitTs - trade.entryTs) / DAY_MS, 0) /
        tradeCount;
  return {
    totalPnl,
    roiPct,
    avgPnlPerTrade,
    tradeCount,
    winners,
    losers,
    avgRoiPct,
    avgDaysInTrade,
  };
}

/**
 * The empty summary a run with no closed trades carries — every aggregate is
 * zero. Kept as a named helper for the running-backtest placeholder.
 */
export function emptyBacktestSummary(): BacktestSummary {
  return summarizeTrades([], 0);
}
