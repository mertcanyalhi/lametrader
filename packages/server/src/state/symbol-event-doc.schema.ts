import type { RuleEventEntry } from '@lametrader/core';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';

/**
 * A read projection of a `watchlist` document's embedded rule-engine `events`
 * array — the source the state-history reader consumes (ADR-0014).
 *
 * This is a **second, read-focused model on the `watchlist` collection**, owned
 * here rather than by the watchlist repository. The watchlist repository's schema
 * deliberately does not declare `events` (it's a rules concern, out of its
 * surface); this model declares only the id + the events array so the reader can
 * project it with a precise type and no casts. It mirrors the old native-driver
 * `MongoEventLog`, which likewise held its own `watchlist` collection handle,
 * distinct from the watchlist repository's. When the rules resource is ported it
 * takes over the full event log; this projection then folds into it.
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
   */
  @Prop({ type: [MongooseSchema.Types.Mixed], default: undefined })
  events?: RuleEventEntry[];
}

/**
 * The compiled Mongoose schema for {@link SymbolEventDoc}.
 */
export const SymbolEventDocSchema = SchemaFactory.createForClass(SymbolEventDoc);
