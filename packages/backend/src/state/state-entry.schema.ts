import type { StateScope, StateValue } from '@lametrader/core';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';

/**
 * One persisted rule-engine state entry in the `state` collection.
 *
 * Mirrors the native-driver `MongoStateRepository` document shape exactly:
 * partitioned by `profileId` (#281, ADR-0014) with one document per
 * `(profileId, scope, symbolId?, key)`, the value stored under `value` as a
 * `Mixed` type so the tagged-union {@link StateValue} (`{ type, value }`,
 * ADR-0013) round-trips verbatim — no flattening, no coercion. For a global
 * entry `symbolId` is `null`, so the compound unique index's null-equality still
 * enforces one-entry-per-key in the global scope.
 *
 * The document `_id` is the default auto ObjectId (the identity is the compound
 * quadruple, enforced by the unique index, not the `_id`) — matching the old
 * repository, which never set `_id`.
 */
@Schema({ collection: 'state', versionKey: false })
export class StateEntry {
  /**
   * The profile namespace the entry lives in (#281).
   */
  @Prop({ type: String, required: true })
  profileId!: string;

  /**
   * Which scope the entry lives in (a {@link StateScope} value).
   */
  @Prop({ type: String, required: true })
  scope!: StateScope;

  /**
   * The owning watched symbol id, or `null` when `scope === Global`.
   */
  @Prop({ type: String, default: null })
  symbolId!: string | null;

  /**
   * The state key.
   */
  @Prop({ type: String, required: true })
  key!: string;

  /**
   * The stored value, with its type tag preserved. `Mixed` because it is the
   * tagged-union {@link StateValue} shape stored verbatim (ADR-0013).
   */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  value!: StateValue;

  /**
   * Last-write epoch ms (the caller-supplied `ts`; see ADR-0012).
   */
  @Prop({ type: Number, required: true })
  updatedAt!: number;
}

/**
 * The compiled Mongoose schema for {@link StateEntry}.
 *
 * The compound `(profileId, scope, symbolId, key)` unique index is the natural
 * key and de-dupes upserts — the schema-level twin of the old repository's
 * `ensureIndexes()`, synced on bootstrap.
 */
export const StateEntrySchema = SchemaFactory.createForClass(StateEntry);
StateEntrySchema.index(
  { profileId: 1, scope: 1, symbolId: 1, key: 1 },
  { unique: true, name: 'profileId_scope_symbolId_key_unique' },
);
