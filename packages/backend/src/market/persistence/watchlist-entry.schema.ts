import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * One persisted watched symbol in the `watchlist` collection.
 *
 * Mirrors the native-driver `MongoWatchlistRepository` document shape exactly:
 * the canonical symbol id is the document `_id` (a plain string, not an ObjectId
 * — the id *is* the identity), with the instrument fields and the per-symbol
 * `periods` stored alongside.
 *
 * The collection's documents may also carry an `events` array written by the
 * rule engine's event log (a rules concern, out of the watchlist surface); it is
 * neither declared here nor read by this schema's mapper.
 */
@Schema({ collection: 'watchlist', versionKey: false })
export class WatchlistEntry {
  /**
   * Canonical symbol id (e.g. `"crypto:BTCUSDT"`) — used verbatim as the string
   * `_id`.
   */
  @Prop({ type: String, required: true })
  _id!: string;

  /**
   * Asset-class string (a {@link import('@lametrader/core').SymbolType} value).
   */
  @Prop({ type: String, required: true })
  type!: string;

  /**
   * Human-readable description, e.g. `"Bitcoin / TetherUS"`.
   */
  @Prop({ type: String, required: true })
  description!: string;

  /**
   * Venue / exchange the instrument trades on, e.g. `"Binance"`.
   */
  @Prop({ type: String, required: true })
  exchange!: string;

  /**
   * Pricing currency (optional, source-dependent — present from Binance / a
   * Yahoo lookup, absent from a Yahoo search hit).
   */
  @Prop({ type: String })
  currency?: string;

  /**
   * The per-symbol period strings (each a {@link import('@lametrader/core').Period} value).
   */
  @Prop({ type: [String], required: true })
  periods!: string[];
}

/**
 * The compiled Mongoose schema for {@link WatchlistEntry}.
 */
export const WatchlistEntrySchema = SchemaFactory.createForClass(WatchlistEntry);
