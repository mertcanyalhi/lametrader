import type { RuleEventEntry } from '@lametrader/core';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';

/**
 * The projection of a `watchlist` document's embedded rule-engine `events` array
 * — the symbol side of the shared event log (ADR-0014).
 *
 * This is a **second model on the `watchlist` collection**, owned here (the event
 * log), not by the watchlist repository. The watchlist repository's schema
 * deliberately does not declare `events` (it's a rules concern, out of its
 * surface); this model declares only the id + the events array so the event log
 * can push to and project it with a precise type and no casts. It mirrors the old
 * native-driver `MongoEventLog`, which likewise held its own `watchlist`
 * collection handle, distinct from the watchlist repository's.
 *
 * The consolidation of #488 makes this the **one** model/reader over the watchlist
 * `events[]`: the state resource's earlier temporary duplicate was removed and its
 * `StateHistoryService` now reads through this shared event log.
 *
 * The `events` entries are stored `Mixed` so the {@link RuleEventEntry} tagged
 * union — including the tagged {@link import('@lametrader/core').StateValue}
 * payloads (ADR-0013) — round-trips verbatim.
 */
@Schema({ collection: 'watchlist', versionKey: false })
export class SymbolEventDoc {
  /**
   * Canonical symbol id — the `watchlist` document `_id`.
   */
  @Prop({ type: String, required: true })
  _id!: string;

  /**
   * The mirrored rule-engine events in append order (absent until the engine
   * has written any).
   *
   * Indexed on the embedded `ts` (multikey) — declared up front so a future
   * `$elemMatch` push-down needs no schema-time change; today the reader fetches
   * the whole array and windows in memory (matching the old `MongoEventLog`).
   */
  @Prop({ type: [MongooseSchema.Types.Mixed], default: undefined, index: false })
  events?: RuleEventEntry[];
}

/**
 * The compiled Mongoose schema for {@link SymbolEventDoc}.
 */
export const SymbolEventDocSchema = SchemaFactory.createForClass(SymbolEventDoc);

// Multikey index on the embedded events' `ts` — the windowed-read companion the
// old `MongoEventLog.ensureIndexes` created on `watchlist.events.ts`.
SymbolEventDocSchema.index({ 'events.ts': 1 });
