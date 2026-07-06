import type { RuleEventEntry } from '@lametrader/core';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';

/**
 * One persisted run event in the `backtest_events` collection — a
 * {@link RuleEventEntry} recorded by a backtest's isolated engine, keyed to the
 * owning backtest.
 *
 * Stored in a dedicated collection (not embedded on the backtest) so a chatty
 * profile over a long range can never blow Mongo's 16 MB per-document cap. The
 * `backtestId` + `seq` pair preserves the engine's emission order for the
 * newest-first window read; the whole entry rides in `entry` as `Mixed` (a
 * tagged union stored verbatim). Cascade-deleted with its backtest.
 */
@Schema({ collection: 'backtest_events', versionKey: false })
export class BacktestEventDoc {
  /** The owning backtest's id. */
  @Prop({ type: String, required: true, index: true })
  backtestId!: string;

  /** Monotonic per-backtest sequence, preserving engine emission order. */
  @Prop({ type: Number, required: true })
  seq!: number;

  /** The recorded rule-event entry (tagged union stored verbatim). */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  entry!: RuleEventEntry;
}

/**
 * The compiled Mongoose schema for {@link BacktestEventDoc}.
 */
export const BacktestEventSchema = SchemaFactory.createForClass(BacktestEventDoc);
