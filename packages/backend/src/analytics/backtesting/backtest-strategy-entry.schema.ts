import type { BacktestStrategyEntry, BacktestStrategyExit } from '@lametrader/core';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';

/**
 * One persisted backtest strategy in the `backtest_strategies` collection.
 *
 * The strategy id is the document `_id` (a plain string, not an ObjectId — the id
 * *is* the identity), with the mutable fields and timestamps stored alongside.
 *
 * `entry` and `exit` embed tagged {@link import('@lametrader/core').StateValue}s
 * and threshold unions the domain validates, so they are stored as `Mixed` and
 * round-tripped verbatim — no casting, no key-stripping — matching the
 * behaviour the `runBacktestStrategyRepositoryContract` suite pins.
 */
@Schema({ collection: 'backtest_strategies', versionKey: false })
export class BacktestStrategyEntryDoc {
  /**
   * Strategy id (canonical key) — used verbatim as the string `_id`.
   */
  @Prop({ type: String, required: true })
  _id!: string;

  /**
   * Human-readable, unique name.
   */
  @Prop({ type: String, required: true })
  name!: string;

  /**
   * Free-text description (may be empty).
   */
  @Prop({ type: String, required: true })
  description!: string;

  /**
   * The required entry definition (`{ signal: { key, value } }`). `Mixed` because
   * the embedded state value is a discriminated union stored verbatim.
   */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  entry!: BacktestStrategyEntry;

  /**
   * The exit definition (`{ signal?, profitTarget?, stopLoss? }`). `Mixed` for the
   * same reason as `entry`.
   */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  exit!: BacktestStrategyExit;

  /**
   * Creation time, epoch milliseconds.
   */
  @Prop({ type: Number, required: true })
  createdAt!: number;

  /**
   * Last-update time, epoch milliseconds.
   */
  @Prop({ type: Number, required: true })
  updatedAt!: number;
}

/**
 * The compiled Mongoose schema for {@link BacktestStrategyEntryDoc}.
 */
export const BacktestStrategyEntrySchema = SchemaFactory.createForClass(BacktestStrategyEntryDoc);
