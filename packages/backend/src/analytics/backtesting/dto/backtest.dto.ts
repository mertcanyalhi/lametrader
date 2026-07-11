import {
  type BacktestOpenPosition,
  BacktestStatus,
  type BacktestTrade,
  Period,
} from '@lametrader/core';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BacktestCommissionDto } from './backtest-commission.dto.js';
import { BacktestStrategyDto } from './backtest-strategy.dto.js';

/**
 * The immutable run inputs a backtest was executed with.
 *
 * Documentation only — pins the OpenAPI contract; responses are the domain
 * objects serialized as-is.
 */
export class BacktestParamsDto {
  /** The watched symbol the run replayed. */
  @ApiProperty()
  symbolId!: string;

  /** The profile whose rules drove the run. */
  @ApiProperty()
  profileId!: string;

  /** The profile's name at run time (snapshotted). */
  @ApiProperty()
  profileName!: string;

  /** The chart period the run is anchored to. */
  @ApiProperty({ enum: Period })
  period!: Period;

  /** Replay window start, epoch milliseconds (inclusive). */
  @ApiProperty()
  start!: number;

  /** Replay window end, epoch milliseconds (exclusive). */
  @ApiProperty()
  end!: number;

  /** Starting equity. */
  @ApiProperty()
  initialCapital!: number;

  /** The per-fill commission model. */
  @ApiProperty({ type: BacktestCommissionDto })
  commission!: BacktestCommissionDto;
}

/**
 * Aggregate metrics over a run's closed trades.
 *
 * Documentation only.
 */
export class BacktestSummaryDto {
  /** Σ of every closed trade's `pnl`. */
  @ApiProperty()
  totalPnl!: number;

  /** `totalPnl / initialCapital × 100`. */
  @ApiProperty()
  roiPct!: number;

  /** `totalPnl / tradeCount` (`0` with no trades). */
  @ApiProperty()
  avgPnlPerTrade!: number;

  /** Number of closed trades. */
  @ApiProperty()
  tradeCount!: number;

  /** Closed trades with `pnl > 0`. */
  @ApiProperty()
  winners!: number;

  /** Closed trades with `pnl < 0`. */
  @ApiProperty()
  losers!: number;

  /** Mean of per-trade `roiPct`. */
  @ApiProperty()
  avgRoiPct!: number;

  /** Mean of `(exitTs − entryTs)` in fractional days. */
  @ApiProperty()
  avgDaysInTrade!: number;
}

/**
 * A running backtest's live progress: elapsed replay days over total days.
 *
 * Documentation only.
 */
export class BacktestProgressDto {
  /** Replay days elapsed so far (fractional). */
  @ApiProperty()
  elapsedDays!: number;

  /** Total days spanned by `[start, end]` (fractional). */
  @ApiProperty()
  totalDays!: number;
}

/**
 * The response shape of a backtest — the running one (with `progress`) or a
 * completed, persisted result.
 *
 * Documentation only — pins the OpenAPI contract; responses are not validated.
 */
export class BacktestDto {
  /** The run id and persisted id (identical). */
  @ApiProperty()
  id!: string;

  /** Auto-generated, renameable display name. */
  @ApiProperty()
  name!: string;

  /** Lifecycle status. */
  @ApiProperty({ enum: BacktestStatus })
  status!: BacktestStatus;

  /** Creation time, epoch milliseconds. */
  @ApiProperty()
  createdAt!: number;

  /** Last-update time, epoch milliseconds. */
  @ApiProperty()
  updatedAt!: number;

  /** Completion time, epoch milliseconds — present only once the run has completed. */
  @ApiPropertyOptional()
  completedAt?: number;

  /** The immutable run inputs. */
  @ApiProperty({ type: BacktestParamsDto })
  params!: BacktestParamsDto;

  /** The source strategy id. */
  @ApiProperty()
  strategyId!: string;

  /** The full strategy snapshot as of run time. */
  @ApiProperty({ type: BacktestStrategyDto })
  strategy!: BacktestStrategyDto;

  /** Closed round trips, in exit order. */
  @ApiProperty({ type: Object, isArray: true })
  trades!: BacktestTrade[];

  /** The position still open at `end`, if any. */
  @ApiPropertyOptional({ type: Object })
  openPosition?: BacktestOpenPosition;

  /** Aggregate metrics over the closed trades. */
  @ApiProperty({ type: BacktestSummaryDto })
  summary!: BacktestSummaryDto;

  /** Live progress — present only while the backtest is running. */
  @ApiPropertyOptional({ type: BacktestProgressDto })
  progress?: BacktestProgressDto;
}
