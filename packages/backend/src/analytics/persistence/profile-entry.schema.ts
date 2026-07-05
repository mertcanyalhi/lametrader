import type { IndicatorInstance, ProfileScopeSpec } from '@lametrader/core';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';

/**
 * One persisted profile in the `profiles` collection.
 *
 * Mirrors the native-driver `MongoProfileRepository` document shape exactly: the
 * profile id is the document `_id` (a plain string, not an ObjectId — the id *is*
 * the identity), with the mutable fields, timestamps, and the embedded
 * `indicators` array stored alongside.
 *
 * `scope` (a discriminated union) and each entry of `indicators` (whose `inputs`
 * is an open `Record<string, unknown>` validated by the domain, not here) are
 * stored as `Mixed` so Mongoose round-trips them verbatim — no casting, no
 * key-stripping — matching the schema-agnostic native-driver behaviour the
 * `runProfileRepositoryContract` suite pins.
 */
@Schema({ collection: 'profiles', versionKey: false })
export class ProfileEntry {
  /**
   * Profile id (canonical key) — used verbatim as the string `_id`.
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
   * Whether the profile is active.
   */
  @Prop({ type: Boolean, required: true })
  enabled!: boolean;

  /**
   * Which watched symbols the profile applies to (`{ type: all }` or
   * `{ type: symbols, symbolIds }`). `Mixed` because the shape is a discriminated
   * union stored verbatim.
   */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  scope!: ProfileScopeSpec;

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

  /**
   * Attached indicator instances, in attachment order. `Mixed` array because each
   * instance carries an open `inputs` record the domain owns.
   */
  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  indicators!: IndicatorInstance[];
}

/**
 * The compiled Mongoose schema for {@link ProfileEntry}.
 */
export const ProfileEntrySchema = SchemaFactory.createForClass(ProfileEntry);
