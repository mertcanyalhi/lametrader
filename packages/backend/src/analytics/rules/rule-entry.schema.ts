import type { Action, ConditionNode, Expiration, RuleScope, Trigger } from '@lametrader/core';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';

/**
 * One persisted rule in the `rules` collection, keyed by the rule's own id
 * (`_id`).
 *
 * Mirrors the native-driver `MongoRuleRepository` document shape exactly
 * (`RuleDocument = { _id } & Omit<Rule, 'id'>`): the queryable scalars
 * (`profileId`, `enabled`, `order`, timestamps) are typed columns, while the
 * complex nested shapes — `scope`, `condition` (recursive tree), `trigger`,
 * `expiration` (`{ at }` or `null`), and the `actions` array — are stored `Mixed`
 * so the greenfield v2 rule shape (ADR-0016) round-trips verbatim, no flattening
 * or coercion. The engine trusts the boundary schema at evaluation (ADR-0016 #11),
 * so the store does not re-model the union types.
 *
 * This model is distinct from the event log's second model on the same collection
 * ({@link import('../../common/persistence/rule-event-doc.schema.js').RuleEventDoc}, which
 * projects only `_id` + `events[]`); the two never overlap because this schema
 * deliberately omits `events`.
 */
@Schema({ collection: 'rules', versionKey: false })
export class RuleEntry {
  /**
   * The rule's stable id — the document `_id` (a generated nanoid string, not an
   * ObjectId), matching the old repository which set `_id` to the rule id.
   */
  @Prop({ type: String, required: true })
  _id!: string;

  /**
   * The parent profile's id.
   */
  @Prop({ type: String, required: true })
  profileId!: string;

  /**
   * Human-readable name (non-empty).
   */
  @Prop({ type: String, required: true })
  name!: string;

  /**
   * Optional free-text description (absent when the rule has none).
   */
  @Prop({ type: String })
  description?: string;

  /**
   * Which symbol(s) the rule applies to — the tagged {@link RuleScope} union,
   * stored `Mixed` so its `Symbol` / `Symbols` / `AllSymbols` variants (and the
   * `scope.symbolId` / `scope.symbolIds` fields the hot-path filter matches on)
   * round-trip verbatim.
   */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  scope!: RuleScope;

  /**
   * The recursive condition tree evaluated each cadence tick — stored `Mixed`.
   */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  condition!: ConditionNode;

  /**
   * The evaluation-cadence {@link Trigger} tagged union — stored `Mixed`.
   */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  trigger!: Trigger;

  /**
   * When the rule stops firing (`{ at }`) or `null` for never — stored `Mixed`
   * so both variants round-trip.
   */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  expiration!: Expiration;

  /**
   * Side-effects performed on fire (non-empty) — the {@link Action} tagged union
   * array, stored `Mixed`.
   */
  @Prop({ type: [MongooseSchema.Types.Mixed], required: true })
  actions!: Action[];

  /**
   * Whether the rule is currently active.
   */
  @Prop({ type: Boolean, required: true })
  enabled!: boolean;

  /**
   * Ordering hint within the parent profile (the dispatcher's iteration order).
   */
  @Prop({ type: Number, required: true })
  order!: number;

  /**
   * Creation time (epoch ms).
   */
  @Prop({ type: Number, required: true })
  createdAt!: number;

  /**
   * Last-update time (epoch ms).
   */
  @Prop({ type: Number, required: true })
  updatedAt!: number;

  /**
   * Last time the orchestrator fired this rule (epoch ms); absent until the first
   * fire (issue #426).
   */
  @Prop({ type: Number })
  lastFiredAt?: number;
}

/**
 * The compiled Mongoose schema for {@link RuleEntry}.
 *
 * The indexes are the schema-level twin of the old repository's `ensureIndexes()`
 * (synced on bootstrap): `{ profileId, order }` for the per-profile ordered read
 * and two `scope`-prefixed indexes so every `listForSymbol` `$or` branch is
 * index-supported and the hot-path rule lookup never falls back to a scan.
 */
export const RuleEntrySchema = SchemaFactory.createForClass(RuleEntry);
RuleEntrySchema.index({ profileId: 1, order: 1 });
RuleEntrySchema.index({ 'scope.kind': 1, 'scope.symbolId': 1 });
RuleEntrySchema.index({ 'scope.kind': 1, 'scope.symbolIds': 1 });
