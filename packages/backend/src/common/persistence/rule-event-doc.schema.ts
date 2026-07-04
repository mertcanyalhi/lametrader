import type { RuleEventEntry } from '@lametrader/core';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';

/**
 * The projection of a `rules` document's embedded rule-engine `events` array —
 * the rule side of the shared event log (ADR-0014).
 *
 * This is a **second model on the `rules` collection**, owned here (the event
 * log), distinct from the rule store's model. The rule store's schema
 * ({@link import('../rules/rule-entry.schema.js').RuleEntry}) carries the rule's
 * own fields and deliberately does not declare `events`; this model declares only
 * the id + the events array so the event log can push to and project it without
 * colliding with the rule store. It mirrors the old native-driver `MongoEventLog`,
 * which held its own `rules` collection handle distinct from
 * `MongoRuleRepository`'s.
 *
 * The `events` entries are stored `Mixed` so the {@link RuleEventEntry} tagged
 * union round-trips verbatim.
 */
@Schema({ collection: 'rules', versionKey: false })
export class RuleEventDoc {
  /**
   * Stable rule id — the `rules` document `_id`.
   */
  @Prop({ type: String, required: true })
  _id!: string;

  /**
   * The mirrored rule-engine events in append order (absent until the engine
   * has written any).
   *
   * Indexed on the embedded `ts` (multikey) — the rule-side companion of the
   * `watchlist.events.ts` index the old `MongoEventLog.ensureIndexes` created.
   */
  @Prop({ type: [MongooseSchema.Types.Mixed], default: undefined, index: false })
  events?: RuleEventEntry[];
}

/**
 * The compiled Mongoose schema for {@link RuleEventDoc}.
 */
export const RuleEventDocSchema = SchemaFactory.createForClass(RuleEventDoc);

// Multikey index on the embedded events' `ts` — the rule-side companion the old
// `MongoEventLog.ensureIndexes` created on `rules.events.ts`.
RuleEventDocSchema.index({ 'events.ts': 1 });
