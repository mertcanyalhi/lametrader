import type {
  BacktestOpenPosition,
  BacktestParams,
  BacktestStatus,
  BacktestStrategy,
  BacktestSummary,
  BacktestTrade,
} from '@lametrader/core';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';

/**
 * One persisted (completed) backtest in the `backtests` collection.
 *
 * The run id is the document `_id` (a plain string — the id *is* the identity).
 * `params`, the embedded `strategy` snapshot, `trades`, `openPosition`, and
 * `summary` carry discriminated / nested domain shapes, so they are stored as
 * `Mixed` and round-tripped verbatim (no casting, no key-stripping) — matching
 * the behaviour the `runBacktestRepositoryContract` suite pins. Run events are
 * **not** embedded here; they live in the `backtest_events` collection.
 */
@Schema({ collection: 'backtests', versionKey: false })
export class BacktestDoc {
  /** Backtest id (canonical key) — used verbatim as the string `_id`. */
  @Prop({ type: String, required: true })
  _id!: string;

  /** Auto-generated, renameable display name. */
  @Prop({ type: String, required: true })
  name!: string;

  /** Lifecycle status (always `completed` once persisted). */
  @Prop({ type: String, required: true })
  status!: BacktestStatus;

  /** Creation time, epoch milliseconds. */
  @Prop({ type: Number, required: true })
  createdAt!: number;

  /** Last-update time, epoch milliseconds. */
  @Prop({ type: Number, required: true })
  updatedAt!: number;

  /** The immutable run inputs. `Mixed` — nested params + commission. */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  params!: BacktestParams;

  /** The source strategy id (may no longer resolve). */
  @Prop({ type: String, required: true })
  strategyId!: string;

  /** The full strategy snapshot as of run time. `Mixed` — tagged unions. */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  strategy!: BacktestStrategy;

  /** Closed round trips. `Mixed` so the array round-trips verbatim. */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  trades!: BacktestTrade[];

  /** The position still open at `end`, if any. `Mixed`, optional. */
  @Prop({ type: MongooseSchema.Types.Mixed, required: false })
  openPosition?: BacktestOpenPosition;

  /** Aggregate metrics over the closed trades. `Mixed`. */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  summary!: BacktestSummary;
}

/**
 * The compiled Mongoose schema for {@link BacktestDoc}.
 */
export const BacktestSchema = SchemaFactory.createForClass(BacktestDoc);
